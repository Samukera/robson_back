const app = require('express')();
const http = require('http').createServer(app);
const short = require('short-uuid');
require('dotenv').config()
const io = require("socket.io")(http, {
    cors: {
        origin: process.env.ORIGIN || 'http://localhost:8081',
        methods: ["GET", "POST"]
    }
});

setInterval(() => {
    io.emit('ping');
    logRooms();
}, 20000);

app.get('/', (req, res) => {
    res.send('<h1>Hello world</h1>');
});

http.listen(process.env.PORT || 3000, () => {
    console.log(`listening on *:${process.env.PORT || 3000}`);
});

let players = [];
let tickets = [];
let gameType = [];

let gameTypes = [
    { name: 'Fibonacci', values: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, '☕'] },
    { name: 'Camisetas', values: ['I', 'PP', 'P', 'M', 'L', 'XL', '☕'] },
    { name: 'Mult. 2', values: [0, 1, 2, 4, 8, 16, 32, 64, '☕'] },
]

io.on('connection', (socket) => {
    socket.on('sendEmoji', ({ to, emoji }) => {
        const fromPlayer = players.find(p => p.id == socket.id);
        if (fromPlayer) {
            io.to(fromPlayer.roomId).emit('receiveEmoji', {
                from: fromPlayer.id,
                to,
                emoji,
            });
        }
    });

    console.log('A user connected', socket.id);
    let roomId = socket.handshake.query['roomId'];
    if (!roomId || roomId === 'undefined') {
        roomId = short.generate();
        socket.emit('room', roomId);
    }
    socket.emit('gameTypes', gameTypes)
    socket.join(roomId);

    players.push({ id: socket.id, name: '', role: 'player', roomId: roomId });
    gameType.push({ id: socket.id, gameType: gameTypes[0], roomId: roomId });

    socket.on('name', ({ name, role }) => {
        let player = players.find(p => p.id == socket.id);
        console.log(`User entered name ${name} as ${role}`);
        if (player) {
            console.log(`Changing name from ${player.name} to ${name}, role to ${role}`);
            player.name = name;
            player.role = role || 'player';
        }
        updateClientsInRoom(roomId);
    });

    socket.on('resetCurrent', () => {
        const currentTicket = tickets.find(t => t.roomId === roomId && t.votingOn);
        if (!currentTicket) return;

        // Resetar votos dos jogadores
        players
            .filter(p => p.roomId === roomId && p.role !== 'observer')
            .forEach(p => p.vote = undefined);

        currentTicket.score = null;

        io.to(roomId).emit('restart');
        updateClientsInRoom(roomId);
    });

    socket.on("selectTicket", (ticketId) => {
        console.log("🟡 [selectTicket] Ticket selecionado:", ticketId);

        // Desativa todos os tickets da sala
        tickets
            .filter(t => t.roomId === roomId)
            .forEach(t => t.votingOn = false);

        // Ativa o ticket selecionado
        const selected = tickets.find(t => t.id === ticketId && t.roomId === roomId);
        if (selected) {
            selected.votingOn = true;
            console.log("✅ [selectTicket] Marcado como ativo:", selected.name);
        }

        updateClientsInRoom(roomId);
    });

    socket.on("resetCurrent", () => {
        const roomTickets = tickets.filter(t => t.roomId === roomId);
        const ticket = roomTickets.find(t => t.votingOn);
        if (!ticket) return;

        ticket.score = '';
        ticket.average = '';
        ticket.closest = '';

        players
            .filter(p => p.roomId === roomId && p.role !== 'observer')
            .forEach(p => p.vote = undefined);

        io.to(roomId).emit("restart"); // para esconder as cartas e resetar voto no frontend
        updateClientsInRoom(roomId);
    });


    socket.on("nextTicket", () => {
        const roomTickets = tickets.filter(t => t.roomId === roomId);
        const current = roomTickets.find(t => t.votingOn);

        if (current) {
            current.votingOn = false;
            current.done = true;
            // ⛔️ NÃO zere os scores aqui — preserve o resultado da votação
        }

        const next = roomTickets.find(t => !t.done && !t.votingOn);

        if (next) {
            next.votingOn = true;
        }

        // 🔄 Limpar apenas os votos dos jogadores (não os tickets)
        players
            .filter(p => p.roomId === roomId && p.role !== 'observer')
            .forEach(p => p.vote = undefined);

        io.to(roomId).emit("restart"); // apenas para virar as cartas
        updateClientsInRoom(roomId);   // para enviar o novo estado
    });


    socket.on('vote', (vote) => {
        let player = players.find(p => p.id == socket.id);
        if (player) {
            if (player.role === 'observer') {
                console.log(`Observer ${player.name} attempted to vote, ignoring.`);
                return;
            }
            player.vote = vote;
            console.log(`Player ${player.name} voted ${player.vote}`);
        }

        const playersInRoom = players.filter(p => p.roomId == roomId && p.role !== 'observer');
        if (playersInRoom.length > 0 && playersInRoom.every(p => p.vote)) {
            showVotes(roomId);
        }
        updateClientsInRoom(roomId);
    });

    socket.on('show', () => {
        showVotes(roomId);
    });

    socket.on('restart', () => {
        restartGame(roomId);
    });

    socket.on('gameTypeChanged', (newGameType) => {
        gameType.find(p => p.roomId == roomId).gameType = newGameType;
        updateClientsInRoom(roomId);
    });

    socket.on('ticket', (updatedTickets) => {
        tickets = tickets.filter(ticket => ticket.roomId !== roomId);
        for (const ticket of updatedTickets) {
            ticket.roomId = roomId;
        }
        if (updatedTickets.length === 1) {
            updatedTickets[0].votingOn = true;
        }

        tickets.push(...updatedTickets)
        updateClientsInRoom(roomId);
    });

    socket.on('disconnect', () => {
        const player = players.find(player => player.id === socket.id);
        console.log(`Player ${player.name} has disconnected`);
        players = players.filter(player => player.id !== socket.id);
        updateClientsInRoom(roomId);
    });

    socket.on('pong', () => {
        let player = players.find(p => p.id == socket.id);
        // keeping the connection alive
    })
});

function updateClientsInRoom(roomId) {
    const roomPlayers = players.filter(p => p.roomId == roomId);
    const roomTickets = tickets.filter(p => p.roomId == roomId);
    const roomGameType = gameType.find(p => p.roomId == roomId)?.gameType ?? gameTypes[0];

    io.to(roomId).emit('update', {
        players: roomPlayers,
        tickets: roomTickets,
        gameType: roomGameType
    });

    console.log("📦 [updateClientsInRoom] Tickets enviados:");
    roomTickets.forEach(t => {
        console.log(`- ${t.name}: votingOn = ${t.votingOn}`);
    });
}

function restartGame(roomId) {
    const roomPlayers = players.filter(p => p.roomId == roomId);
    const roomTickets = tickets.filter(p => p.roomId == roomId);
    const roomGameType = gameType.find(p => p.roomId == roomId).gameType ?? gameTypes[0];

    roomPlayers.forEach(p => p.vote = undefined); // reset all the player's votes

    const ticketVotingOn = roomTickets.find(f => f.votingOn);
    if (!(ticketVotingOn && !ticketVotingOn.score)) {
        roomTickets.forEach(p => p.votingOn = false);
        const ticketToVoteOn = roomTickets.find(t => !t.score);
        if (ticketToVoteOn) {
            ticketToVoteOn.votingOn = true;
        }
    }
    console.log(`Restarted game with Players: ${roomPlayers.map(p => p.name).join(", ")}`);
    io.to(roomId).emit('restart');
    io.to(roomId).emit('update', {
        players: roomPlayers,
        tickets: roomTickets,
        gameType: roomGameType
    });
}

function logRooms() {
    const rooms = players.map(e => e.roomId);
    console.log(players, 'players');
    if (rooms) {
        for (const room of rooms.filter((val, i, arr) => arr.indexOf(val) == i)) {
            const playersInRoom = players.filter(p => p.roomId == room).map(p => p.name);
            console.log(`Room: ${room} - Players: ${playersInRoom.join(", ")}`);
        }
    }
}

function showVotes(roomId) {
    const roomTickets = tickets.filter(p => p.roomId == roomId);
    const average = getAverage(roomId);
    const fib = gameType.find(p => p.roomId == roomId).gameType.values;

    let closest;
    let avg;

    if (average === '☕') {
        closest = '☕';
        avg = '☕';
    } else {
        let upwards = Math.abs(fib.find(p => p >= average) - average);
        let downWards = Math.abs(fib.findLast(p => p <= average) - average);

        if (isNaN(upwards)) {
            const upper = fib.find((v, k) => k >= average);
            const lower = fib.findLast((v, k) => k <= average);
            closest = upper < lower ? upper : lower;
            avg = fib[Math.floor(average)];
        } else {
            closest = upwards < downWards
                ? fib.find(p => p >= average)
                : fib.findLast(p => p <= average);
            avg = average;
        }
    }

    // Salva score no ticket ativo
    if (roomTickets.length > 0) {
        const ticket = roomTickets.find(f => f.votingOn);
        if (ticket) {
            ticket.score = closest;
        }
    }

    io.to(roomId).emit('show', { average: avg, closest: closest });
}

function getAverage(roomId) {
    const roomPlayers = players.filter(p => p.roomId == roomId && p.role !== 'observer');
    const roomGameType = gameType.find(p => p.roomId == roomId).gameType;
    let count = 0;
    let total = 0;
    for (const player of roomPlayers) {
        if (player.vote && player.vote !== '☕') {
            const index = roomGameType.values.indexOf(player.vote);
            let numberValue = Number(player.vote);
            if (isNaN(numberValue)) {
                numberValue = index;
            }

            total += parseInt(numberValue);
            count++;
        }
    }

    // Se todos votaram ☕
    if (count === 0) return '☕';

    return total / count;
}
