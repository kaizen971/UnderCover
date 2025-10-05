import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Animated
} from 'react-native';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, SOCKET_URL } from './config';

let socket;

export default function App() {
  const [screen, setScreen] = useState('auth'); // auth, home, lobby, game, profile
  const [authMode, setAuthMode] = useState('login'); // login, register
  const [loading, setLoading] = useState(false);

  // Auth states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);

  // Game states
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [game, setGame] = useState(null);
  const [myPlayer, setMyPlayer] = useState(null);

  // Chat states
  const [messages, setMessages] = useState([]);
  const [chatMessage, setChatMessage] = useState('');
  const [showChat, setShowChat] = useState(false);

  // Feedback states
  const [showFeedback, setShowFeedback] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (token) {
      socket = io(SOCKET_URL, {
        transports: ['websocket'],
        reconnection: true
      });

      socket.on('connect', () => {
        console.log('Connected to server');
      });

      socket.on('room_update', (updatedGame) => {
        setGame(updatedGame);
        setScreen('lobby');
      });

      socket.on('game_started', (updatedGame) => {
        setGame(updatedGame);
        const player = updatedGame.players.find(p => p.id === socket.id);
        setMyPlayer(player);
        setMessages(updatedGame.messages || []);
        setScreen('game');
      });

      socket.on('vote_update', (updatedGame) => {
        setGame(updatedGame);
      });

      socket.on('round_ended', ({ game: updatedGame, eliminatedPlayer }) => {
        setGame(updatedGame);
        if (eliminatedPlayer) {
          Alert.alert('Round Ended', `${eliminatedPlayer.name} was eliminated!`);
        }
        if (updatedGame.status === 'finished') {
          Alert.alert('Game Over', `Winner: ${updatedGame.winner}`);
          setShowFeedback(true);
        }
      });

      socket.on('new_message', (msg) => {
        setMessages(prev => [...prev, msg]);
      });

      socket.on('error', (error) => {
        Alert.alert('Error', error.message);
      });

      return () => {
        if (socket) socket.disconnect();
      };
    }
  }, [token]);

  const checkAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('token');
      const storedUser = await AsyncStorage.getItem('user');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setPlayerName(JSON.parse(storedUser).username);
        setScreen('home');
      }
    } catch (error) {
      console.error('Auth check error:', error);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        await AsyncStorage.setItem('token', data.token);
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        setPlayerName(data.user.username);
        setScreen('home');
        Alert.alert('Success', 'Logged in successfully!');
      } else {
        Alert.alert('Error', data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Error', 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();

      if (response.ok) {
        await AsyncStorage.setItem('token', data.token);
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        setPlayerName(data.user.username);
        setScreen('home');
        Alert.alert('Success', 'Account created successfully!');
      } else {
        Alert.alert('Error', data.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Register error:', error);
      Alert.alert('Error', 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setScreen('auth');
  };

  const createRoom = async () => {
    if (!roomCode.trim()) {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/game`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ roomCode })
      });

      if (response.ok) {
        socket.emit('join_room', { roomCode, playerName, userId: user.id, createIfNotExists: true });
      } else {
        const data = await response.json();
        Alert.alert('Error', data.error || 'Failed to create room');
      }
    } catch (error) {
      console.error('Create room error:', error);
      Alert.alert('Error', 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!roomCode.trim()) {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }

    setLoading(true);
    try {
      // Check if room exists before joining
      const response = await fetch(`${API_BASE_URL}/game/${roomCode}`);

      if (response.ok) {
        const gameData = await response.json();

        // Check if game has already started
        if (gameData.status !== 'waiting') {
          Alert.alert('Error', 'This game has already started. You cannot join.');
          setLoading(false);
          return;
        }

        // Room exists and is waiting, join it
        socket.emit('join_room', { roomCode, playerName, userId: user.id, createIfNotExists: false });
      } else {
        Alert.alert('Error', 'Room not found. Please check the room code.');
      }
    } catch (error) {
      console.error('Join room error:', error);
      Alert.alert('Error', 'Failed to join room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startGame = () => {
    socket.emit('start_game', { roomCode });
  };

  const vote = (playerId) => {
    if (myPlayer?.hasVoted) {
      Alert.alert('Already Voted', 'You have already voted this round');
      return;
    }
    socket.emit('vote', { roomCode, voterId: socket.id, targetPlayerId: playerId });
  };

  const endRound = () => {
    socket.emit('end_round', { roomCode });
  };

  const sendMessage = () => {
    if (!chatMessage.trim()) return;

    socket.emit('send_message', {
      roomCode,
      playerId: socket.id,
      playerName: myPlayer?.name || playerName,
      message: chatMessage
    });
    setChatMessage('');
  };

  const submitFeedback = async () => {
    if (rating === 0) {
      Alert.alert('Error', 'Please select a rating');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          gameId: game._id,
          rating,
          comment: feedbackComment
        })
      });

      if (response.ok) {
        Alert.alert('Success', 'Thank you for your feedback!');
        setShowFeedback(false);
        setRating(0);
        setFeedbackComment('');
        setScreen('home');
      }
    } catch (error) {
      console.error('Feedback error:', error);
    }
  };

  const renderAuth = () => (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.authContainer}>
        <View style={styles.authHeader}>
          <Text style={styles.logo}>🎭</Text>
          <Text style={styles.title}>UnderCover</Text>
          <Text style={styles.tagline}>Find the spy among friends</Text>
        </View>

        <View style={styles.authToggle}>
          <TouchableOpacity
            style={[styles.toggleButton, authMode === 'login' && styles.toggleButtonActive]}
            onPress={() => setAuthMode('login')}
          >
            <Text style={[styles.toggleText, authMode === 'login' && styles.toggleTextActive]}>
              Login
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, authMode === 'register' && styles.toggleButtonActive]}
            onPress={() => setAuthMode('register')}
          >
            <Text style={[styles.toggleText, authMode === 'register' && styles.toggleTextActive]}>
              Register
            </Text>
          </TouchableOpacity>
        </View>

        {authMode === 'register' && (
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#888"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={authMode === 'login' ? handleLogin : handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {authMode === 'login' ? 'Login' : 'Register'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderHome = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.username?.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.usernameText}>{user?.username}</Text>
            <Text style={styles.statsText}>
              {user?.gamesPlayed || 0} games • {user?.gamesWon || 0} wins
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => setScreen('profile')} style={styles.profileButton}>
          <Text style={styles.profileButtonText}>Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.homeContent}>
        <Text style={styles.homeTitle}>🎭 UnderCover</Text>
        <Text style={styles.homeSubtitle}>Find the spy among friends</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter Room Code"
          placeholderTextColor="#888"
          value={roomCode}
          onChangeText={setRoomCode}
          autoCapitalize="characters"
        />

        <TouchableOpacity style={styles.button} onPress={createRoom} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Room</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={joinRoom}
        >
          <Text style={styles.buttonText}>Join Room</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderProfile = () => (
    <View style={styles.container}>
      <View style={styles.profileHeader}>
        <TouchableOpacity onPress={() => setScreen('home')} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
      </View>

      <View style={styles.profileContent}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarTextLarge}>
            {user?.username?.charAt(0).toUpperCase()}
          </Text>
        </View>

        <Text style={styles.profileUsername}>{user?.username}</Text>
        <Text style={styles.profileEmail}>{user?.email}</Text>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{user?.gamesPlayed || 0}</Text>
            <Text style={styles.statLabel}>Games Played</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{user?.gamesWon || 0}</Text>
            <Text style={styles.statLabel}>Games Won</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{user?.totalScore || 0}</Text>
            <Text style={styles.statLabel}>Total Score</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderLobby = () => (
    <View style={styles.container}>
      <View style={styles.lobbyHeader}>
        <Text style={styles.title}>Room: {game?.roomCode}</Text>
        <Text style={styles.subtitle}>
          {game?.players.length} {game?.players.length === 1 ? 'Player' : 'Players'}
        </Text>
      </View>

      <FlatList
        data={game?.players}
        keyExtractor={(item) => item.id}
        style={styles.playerList}
        renderItem={({ item }) => (
          <View style={styles.playerItem}>
            <View style={styles.playerAvatar}>
              <Text style={styles.playerAvatarText}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.playerName}>{item.name}</Text>
          </View>
        )}
      />

      {game?.players.length >= 3 ? (
        <TouchableOpacity style={styles.button} onPress={startGame}>
          <Text style={styles.buttonText}>Start Game</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.infoBox}>
          <Text style={styles.info}>
            Waiting for players... ({game?.players.length}/3 minimum)
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton]}
        onPress={() => setScreen('home')}
      >
        <Text style={styles.buttonText}>Leave Room</Text>
      </TouchableOpacity>
    </View>
  );

  const renderGame = () => (
    <View style={styles.container}>
      <View style={styles.gameHeader}>
        <Text style={styles.title}>Round {game?.currentRound}</Text>
        {myPlayer && (
          <View style={styles.wordCard}>
            <Text style={styles.roleLabel}>Role: {myPlayer.role.toUpperCase()}</Text>
            <Text style={styles.word}>
              {myPlayer.word || '❓ Mr. White'}
            </Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.gameContent}>
        <View style={styles.playersGrid}>
          {game?.players.filter(p => p.isAlive).map((player) => (
            <View key={player.id} style={styles.playerGameCard}>
              <View style={styles.playerGameAvatar}>
                <Text style={styles.playerGameAvatarText}>
                  {player.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.playerGameName}>{player.name}</Text>
              <Text style={styles.votesText}>Votes: {player.votes || 0}</Text>

              {player.id !== socket?.id && myPlayer?.isAlive && !myPlayer?.hasVoted && (
                <TouchableOpacity
                  style={styles.voteButton}
                  onPress={() => vote(player.id)}
                >
                  <Text style={styles.voteButtonText}>Vote</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.gameFooter}>
        <TouchableOpacity
          style={styles.chatToggle}
          onPress={() => setShowChat(!showChat)}
        >
          <Text style={styles.chatToggleText}>
            💬 Chat {messages.length > 0 && `(${messages.length})`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.endRoundButton}
          onPress={endRound}
        >
          <Text style={styles.endRoundButtonText}>End Round</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showChat}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowChat(false)}
      >
        <View style={styles.chatModal}>
          <View style={styles.chatContainer}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>Chat</Text>
              <TouchableOpacity onPress={() => setShowChat(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.chatMessages}>
              {messages.map((msg, index) => (
                <View key={index} style={styles.chatMessage}>
                  <Text style={styles.chatMessageAuthor}>{msg.playerName}:</Text>
                  <Text style={styles.chatMessageText}>{msg.message}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.chatInput}>
              <TextInput
                style={styles.chatTextInput}
                placeholder="Type a message..."
                placeholderTextColor="#888"
                value={chatMessage}
                onChangeText={setChatMessage}
              />
              <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showFeedback}
        animationType="fade"
        transparent={true}
      >
        <View style={styles.feedbackModal}>
          <View style={styles.feedbackContainer}>
            <Text style={styles.feedbackTitle}>Rate this game</Text>

            <View style={styles.ratingContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                >
                  <Text style={styles.star}>
                    {star <= rating ? '⭐' : '☆'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.input, styles.feedbackInput]}
              placeholder="Leave a comment (optional)"
              placeholderTextColor="#888"
              value={feedbackComment}
              onChangeText={setFeedbackComment}
              multiline
            />

            <TouchableOpacity style={styles.button} onPress={submitFeedback}>
              <Text style={styles.buttonText}>Submit Feedback</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setShowFeedback(false);
                setScreen('home');
              }}
            >
              <Text style={styles.buttonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );

  return (
    <>
      {screen === 'auth' && renderAuth()}
      {screen === 'home' && renderHome()}
      {screen === 'profile' && renderProfile()}
      {screen === 'lobby' && renderLobby()}
      {screen === 'game' && renderGame()}
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  authContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  authHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 80,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#888',
  },
  authToggle: {
    flexDirection: 'row',
    marginBottom: 20,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e2749',
  },
  toggleButton: {
    flex: 1,
    padding: 15,
    alignItems: 'center',
    backgroundColor: '#1e2749',
  },
  toggleButtonActive: {
    backgroundColor: '#6c5ce7',
  },
  toggleText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#fff',
  },
  input: {
    backgroundColor: '#1e2749',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2d3561',
  },
  button: {
    backgroundColor: '#6c5ce7',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#6c5ce7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: '#2d3561',
    shadowColor: '#2d3561',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#1e2749',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  usernameText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statsText: {
    color: '#888',
    fontSize: 14,
  },
  profileButton: {
    backgroundColor: '#2d3561',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  profileButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  homeContent: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  homeTitle: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 8,
  },
  homeSubtitle: {
    fontSize: 18,
    color: '#888',
    textAlign: 'center',
    marginBottom: 40,
  },
  logoutButton: {
    marginTop: 20,
    padding: 12,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#e74c3c',
    fontSize: 16,
  },
  profileHeader: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#1e2749',
  },
  backButton: {
    marginBottom: 10,
  },
  backButtonText: {
    color: '#6c5ce7',
    fontSize: 16,
  },
  profileContent: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  avatarTextLarge: {
    color: '#fff',
    fontSize: 48,
    fontWeight: 'bold',
  },
  profileUsername: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  profileEmail: {
    color: '#888',
    fontSize: 16,
    marginBottom: 30,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: '#1e2749',
    padding: 20,
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 5,
  },
  statNumber: {
    color: '#6c5ce7',
    fontSize: 32,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 5,
  },
  lobbyHeader: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#1e2749',
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginTop: 8,
  },
  playerList: {
    flex: 1,
    padding: 20,
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2749',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  playerAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  playerName: {
    color: '#fff',
    fontSize: 16,
    flex: 1,
  },
  infoBox: {
    backgroundColor: '#1e2749',
    padding: 20,
    margin: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  info: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  gameHeader: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#1e2749',
    alignItems: 'center',
  },
  wordCard: {
    backgroundColor: '#2d3561',
    padding: 20,
    borderRadius: 12,
    marginTop: 12,
    width: '100%',
    alignItems: 'center',
  },
  roleLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  word: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  gameContent: {
    flex: 1,
    padding: 20,
  },
  playersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  playerGameCard: {
    width: '48%',
    backgroundColor: '#1e2749',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  playerGameAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  playerGameAvatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  playerGameName: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
  votesText: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  voteButton: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  voteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  gameFooter: {
    padding: 20,
    backgroundColor: '#1e2749',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chatToggle: {
    flex: 1,
    backgroundColor: '#2d3561',
    padding: 12,
    borderRadius: 8,
    marginRight: 8,
    alignItems: 'center',
  },
  chatToggleText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  endRoundButton: {
    flex: 1,
    backgroundColor: '#6c5ce7',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  endRoundButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  chatModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  chatContainer: {
    backgroundColor: '#0a0e27',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '70%',
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2749',
  },
  chatTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    color: '#fff',
    fontSize: 24,
  },
  chatMessages: {
    flex: 1,
    padding: 20,
  },
  chatMessage: {
    marginBottom: 12,
    backgroundColor: '#1e2749',
    padding: 12,
    borderRadius: 8,
  },
  chatMessageAuthor: {
    color: '#6c5ce7',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  chatMessageText: {
    color: '#fff',
    fontSize: 14,
  },
  chatInput: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#1e2749',
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: '#1e2749',
    padding: 12,
    borderRadius: 8,
    marginRight: 8,
    color: '#fff',
  },
  sendButton: {
    backgroundColor: '#6c5ce7',
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  feedbackModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  feedbackContainer: {
    backgroundColor: '#1e2749',
    padding: 30,
    borderRadius: 20,
    width: '100%',
  },
  feedbackTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  ratingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  star: {
    fontSize: 40,
    marginHorizontal: 5,
  },
  feedbackInput: {
    height: 100,
    textAlignVertical: 'top',
  },
});
