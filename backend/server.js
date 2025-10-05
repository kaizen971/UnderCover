require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001;

// OBLIGATOIRE - Trust proxy configuration
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "UnderCover",
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

connectDB();

// Models
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: 'https://ui-avatars.com/api/?name=User' },
  gamesPlayed: { type: Number, default: 0 },
  gamesWon: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

const FeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  createdAt: { type: Date, default: Date.now }
});

const Feedback = mongoose.model('Feedback', FeedbackSchema);

const GameSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, unique: true },
  players: [{
    id: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: String, // 'undercover', 'civilian', 'mr_white'
    word: String,
    isAlive: { type: Boolean, default: true },
    votes: { type: Number, default: 0 },
    hasVoted: { type: Boolean, default: false }
  }],
  messages: [{
    playerId: String,
    playerName: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
  }],
  status: { type: String, enum: ['waiting', 'playing', 'finished'], default: 'waiting' },
  currentRound: { type: Number, default: 0 },
  civilianWord: String,
  undercoverWord: String,
  winner: String, // 'civilians', 'undercover', 'mr_white'
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Game = mongoose.model('Game', GameSchema);

// Middleware for JWT authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', async ({ roomCode, playerName, userId, createIfNotExists }) => {
    try {
      let game = await Game.findOne({ roomCode });

      if (!game) {
        // Only create if explicitly requested
        if (createIfNotExists) {
          game = new Game({
            roomCode,
            players: [{
              id: socket.id,
              userId: userId || null,
              name: playerName,
              isAlive: true,
              hasVoted: false
            }]
          });
          await game.save();
          socket.join(roomCode);
          io.to(roomCode).emit('room_update', game);
          socket.emit('join_success', { game, reconnected: false });
          console.log(`Player ${playerName} created and joined room ${roomCode}`);
        } else {
          // Room doesn't exist and we shouldn't create it
          socket.emit('error', { message: 'Room not found. Please check the room code.' });
          return;
        }
      } else {
        // Check if player is reconnecting (based on userId)
        let existingPlayer = null;
        let isReconnection = false;

        if (userId) {
          existingPlayer = game.players.find(p => p.userId && p.userId.toString() === userId);
          if (existingPlayer) {
            // Player is reconnecting - update their socket ID
            existingPlayer.id = socket.id;
            isReconnection = true;
            console.log(`Player ${playerName} (${userId}) reconnecting to room ${roomCode}`);
          }
        }

        // If not reconnecting, check if it's a new join
        if (!existingPlayer) {
          // Check if game has already started (only block new players)
          if (game.status !== 'waiting') {
            socket.emit('error', { message: 'Game has already started. Cannot join.' });
            return;
          }

          // Check for duplicate by socket ID
          existingPlayer = game.players.find(p => p.id === socket.id);
          if (!existingPlayer) {
            // Check if name is already taken (prevent duplicate names)
            const nameTaken = game.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
            if (nameTaken) {
              socket.emit('error', { message: 'This name is already taken in the room. Please choose another name.' });
              return;
            }

            // New player joining
            game.players.push({
              id: socket.id,
              userId: userId || null,
              name: playerName,
              isAlive: true,
              hasVoted: false
            });
            console.log(`Player ${playerName} joined room ${roomCode}`);
          }
        }

        await game.save();
        socket.join(roomCode);
        io.to(roomCode).emit('room_update', game);
        socket.emit('join_success', { game, reconnected: isReconnection });
      }
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('send_message', async ({ roomCode, playerId, playerName, message }) => {
    try {
      const game = await Game.findOne({ roomCode });
      if (game) {
        game.messages.push({ playerId, playerName, message, timestamp: new Date() });
        await game.save();
        io.to(roomCode).emit('new_message', { playerId, playerName, message, timestamp: new Date() });
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('start_game', async ({ roomCode }) => {
    try {
      const game = await Game.findOne({ roomCode });
      if (!game || game.players.length < 3) {
        socket.emit('error', { message: 'Need at least 3 players to start' });
        return;
      }

      // Assign roles and words
      const playerCount = game.players.length;
      const undercoverCount = Math.floor(playerCount / 4) || 1;

      // Shuffle players
      const shuffledPlayers = [...game.players].sort(() => Math.random() - 0.5);

      // Sample words (you can expand this)
      const wordPairs = [
        { civilian: 'Pomme', undercover: 'Orange' },
        { civilian: 'Chat', undercover: 'Chien' },
        { civilian: 'Voiture', undercover: 'Moto' }
      ];

      const selectedPair = wordPairs[Math.floor(Math.random() * wordPairs.length)];

      shuffledPlayers.forEach((player, index) => {
        if (index < undercoverCount) {
          player.role = 'undercover';
          player.word = selectedPair.undercover;
        } else if (index === playerCount - 1 && playerCount > 4) {
          player.role = 'mr_white';
          player.word = null;
        } else {
          player.role = 'civilian';
          player.word = selectedPair.civilian;
        }
      });

      game.status = 'playing';
      game.civilianWord = selectedPair.civilian;
      game.undercoverWord = selectedPair.undercover;
      game.currentRound = 1;
      await game.save();

      io.to(roomCode).emit('game_started', game);
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  socket.on('vote', async ({ roomCode, voterId, targetPlayerId }) => {
    try {
      const game = await Game.findOne({ roomCode });
      const voter = game.players.find(p => p.id === voterId);
      const targetPlayer = game.players.find(p => p.id === targetPlayerId);

      if (targetPlayer && voter && !voter.hasVoted && voter.isAlive) {
        targetPlayer.votes += 1;
        voter.hasVoted = true;
        await game.save();
        io.to(roomCode).emit('vote_update', game);
      }
    } catch (error) {
      console.error('Error voting:', error);
    }
  });

  socket.on('end_round', async ({ roomCode }) => {
    try {
      const game = await Game.findOne({ roomCode });

      // Find player with most votes
      let maxVotes = 0;
      let eliminatedPlayer = null;

      game.players.forEach(player => {
        if (player.isAlive && player.votes > maxVotes) {
          maxVotes = player.votes;
          eliminatedPlayer = player;
        }
      });

      if (eliminatedPlayer) {
        eliminatedPlayer.isAlive = false;
      }

      // Reset votes for next round
      game.players.forEach(player => {
        player.votes = 0;
        player.hasVoted = false;
      });

      game.currentRound += 1;

      // Check win conditions
      const alivePlayers = game.players.filter(p => p.isAlive);
      const aliveUndercovers = alivePlayers.filter(p => p.role === 'undercover');
      const aliveCivilians = alivePlayers.filter(p => p.role === 'civilian');
      const aliveMrWhite = alivePlayers.filter(p => p.role === 'mr_white');

      if (aliveUndercovers.length === 0 && aliveMrWhite.length === 0) {
        game.status = 'finished';
        game.winner = 'civilians';
      } else if (aliveUndercovers.length >= aliveCivilians.length) {
        game.status = 'finished';
        game.winner = 'undercover';
      }

      await game.save();
      io.to(roomCode).emit('round_ended', { game, eliminatedPlayer });
    } catch (error) {
      console.error('Error ending round:', error);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);

    try {
      // Find all games where this socket was a player
      const games = await Game.find({ 'players.id': socket.id });

      for (const game of games) {
        const player = game.players.find(p => p.id === socket.id);

        if (player) {
          // If game is still in waiting status and player is not authenticated, remove them
          if (game.status === 'waiting' && !player.userId) {
            game.players = game.players.filter(p => p.id !== socket.id);
            await game.save();
            io.to(game.roomCode).emit('room_update', game);
            console.log(`Removed guest player ${player.name} from room ${game.roomCode}`);
          } else {
            // For authenticated players or active games, just notify others
            io.to(game.roomCode).emit('player_disconnected', {
              playerId: socket.id,
              playerName: player.name,
              canReconnect: !!player.userId
            });
            console.log(`Player ${player.name} disconnected from room ${game.roomCode} (can reconnect: ${!!player.userId})`);
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// REST API Routes
app.get('/UnderCover', (req, res) => {
  res.json({ message: 'UnderCover API is running', status: 'ok' });
});

app.get('/UnderCover/games', async (req, res) => {
  try {
    const games = await Game.find().sort({ createdAt: -1 }).limit(10);
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/UnderCover/game/:roomCode', async (req, res) => {
  try {
    const game = await Game.findOne({ roomCode: req.params.roomCode });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json(game);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/UnderCover/game', async (req, res) => {
  try {
    const { roomCode } = req.body;

    const existingGame = await Game.findOne({ roomCode });
    if (existingGame) {
      return res.status(400).json({ error: 'Room code already exists' });
    }

    const game = new Game({
      roomCode,
      players: []
    });

    await game.save();
    res.status(201).json(game);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/UnderCover/game/:roomCode', async (req, res) => {
  try {
    await Game.deleteOne({ roomCode: req.params.roomCode });
    res.json({ message: 'Game deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth Routes
app.post('/UnderCover/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;

    const user = new User({
      username,
      email,
      password: hashedPassword,
      avatar
    });

    await user.save();

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        totalScore: user.totalScore
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/UnderCover/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        totalScore: user.totalScore
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/UnderCover/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User Profile Routes
app.get('/UnderCover/user/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/UnderCover/user/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.id !== req.params.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { username, avatar } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { username, avatar },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Feedback Routes
app.post('/UnderCover/feedback', authenticateToken, async (req, res) => {
  try {
    const { gameId, rating, comment } = req.body;

    const feedback = new Feedback({
      userId: req.user.id,
      gameId,
      rating,
      comment
    });

    await feedback.save();
    res.status(201).json(feedback);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/UnderCover/feedback/:gameId', async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ gameId: req.params.gameId })
      .populate('userId', 'username avatar');
    res.json(feedbacks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Statistics Routes
app.get('/UnderCover/stats/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    const games = await Game.find({
      'players.userId': req.params.userId,
      status: 'finished'
    });

    res.json({
      user: {
        username: user.username,
        avatar: user.avatar,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        totalScore: user.totalScore
      },
      recentGames: games.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
