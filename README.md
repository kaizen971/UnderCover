# UnderCover Game

Application React Native Expo avec backend Node.js pour jouer à UnderCover entre potes.

## Structure du projet

```
UnderCover/
├── frontend/          # Application Expo React Native
│   ├── App.js
│   ├── config.js
│   ├── package.json
│   └── ...
├── backend/           # Serveur Node.js Express
│   ├── server.js
│   ├── package.json
│   ├── .env
│   └── ...
└── README.md
```

## Configuration

### Backend
- **Port**: 3001
- **MongoDB**: Collection `UnderCover`
- **WebSocket**: Socket.IO pour la communication temps réel
- **URL publique**: https://mabouya.servegame.com/UnderCover

### Frontend
- **Framework**: React Native Expo
- **API URL**: https://mabouya.servegame.com/UnderCover/UnderCover
- **Socket URL**: https://mabouya.servegame.com/UnderCover

## Lancement du serveur

```bash
cd /home/cheetoh/pi-agent/repo/UnderCover/backend && npm start
```

## Lancement du frontend (développement)

```bash
cd /home/cheetoh/pi-agent/repo/UnderCover/frontend
npm start
```

## Fonctionnalités

- Création et gestion de salles de jeu
- Communication temps réel via WebSocket
- Attribution automatique des rôles (Undercover, Civilian, Mr. White)
- Système de vote
- Interface mobile intuitive

## Technologies

### Backend
- Express.js
- MongoDB avec Mongoose
- Socket.IO
- CORS

### Frontend
- React Native
- Expo
- Socket.IO Client

## Configuration Caddy

Le serveur est accessible via Caddy qui fait le reverse proxy depuis `https://mabouya.servegame.com/UnderCover` vers `localhost:3001`.
