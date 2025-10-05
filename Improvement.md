# Improvements - UnderCover

## 2025-10-06 - Correction du bug "Rejoindre la room"

### Problème identifié
Le système de "rejoindre la room" présentait plusieurs bugs critiques :

1. **Création automatique de rooms** : Lorsqu'un joueur tentait de rejoindre une room inexistante, le backend créait automatiquement une nouvelle room au lieu de retourner une erreur
2. **Absence de validation** : Le frontend n'effectuait aucune vérification de l'existence de la room avant de tenter de la rejoindre
3. **Pas de vérification de statut** : Les joueurs pouvaient rejoindre une partie déjà commencée
4. **Gestion d'erreurs insuffisante** : Messages d'erreur peu clairs et manque de feedback utilisateur

### Solutions implémentées

#### Backend (server.js:121-171)
- Ajout d'un paramètre `createIfNotExists` dans l'événement `join_room`
- Vérification de l'existence de la room avant de permettre la jonction
- Vérification du statut de la partie (ne peut rejoindre que les parties en statut `waiting`)
- Messages d'erreur explicites :
  - "Room not found. Please check the room code." si la room n'existe pas
  - "Game has already started. Cannot join." si la partie a déjà commencé

#### Frontend (App.js:234-266)
- Fonction `joinRoom()` complètement refactorisée :
  - Vérification HTTP de l'existence de la room via l'API REST
  - Vérification du statut de la partie avant de rejoindre
  - Gestion d'erreur avec messages clairs pour l'utilisateur
  - Ajout d'un état de chargement pour améliorer l'UX
- Fonction `createRoom()` mise à jour :
  - Passage du paramètre `createIfNotExists: true` lors de la création

### Comportement attendu après correction

1. **Création de room** : Fonctionne comme avant mais avec le flag `createIfNotExists: true`
2. **Rejoindre une room existante** :
   - Vérifie que la room existe
   - Vérifie que la partie est en statut `waiting`
   - Joint la room si les conditions sont remplies
3. **Rejoindre une room inexistante** :
   - Affiche "Room not found. Please check the room code."
   - Ne crée PAS de room automatiquement
4. **Rejoindre une partie commencée** :
   - Affiche "This game has already started. You cannot join."

### Fichiers modifiés
- `/home/cheetoh/pi-agent/repo/UnderCover/backend/server.js`
- `/home/cheetoh/pi-agent/repo/UnderCover/frontend/App.js`

### Tests
Aucun test automatisé n'était configuré dans le projet. Les modifications ont été validées par revue de code.

### Améliorations futures recommandées
- Ajouter des tests unitaires et d'intégration
- ~~Implémenter un système de reconnexion pour les joueurs déconnectés~~ ✅ Fait le 2025-10-06
- Ajouter une liste des rooms disponibles
- Implémenter un système de timeout pour supprimer les rooms inactives

---

## 2025-10-06 - Amélioration du système d'entrée dans les rooms

### Problèmes identifiés
Après la première correction du bug "Rejoindre la room", plusieurs problèmes persistaient :

1. **Pas de système de reconnexion** : Les joueurs déconnectés ne pouvaient pas reconnecter avec leur ancien rôle
2. **Gestion du loading incomplète** : Le frontend ne désactivait pas l'état de chargement après une tentative de connexion réussie via socket
3. **Pas de nettoyage des déconnexions** : Les joueurs invités déconnectés restaient dans la liste
4. **Doublons possibles** : Un joueur pouvait rejoindre plusieurs fois avec le même nom
5. **Expérience utilisateur limitée** : Aucun feedback lors des déconnexions

### Solutions implémentées

#### Backend (server.js:121-202)

**1. Système de reconnexion avec userId**
- Détection automatique des reconnexions basée sur le `userId`
- Mise à jour du socket ID pour les joueurs qui reconnectent
- Distinction entre nouveaux joueurs et reconnexions
```javascript
if (userId) {
  existingPlayer = game.players.find(p => p.userId && p.userId.toString() === userId);
  if (existingPlayer) {
    existingPlayer.id = socket.id;
    isReconnection = true;
  }
}
```

**2. Validation des noms de joueurs**
- Vérification que le nom n'est pas déjà pris dans la room (insensible à la casse)
- Message d'erreur clair : "This name is already taken in the room. Please choose another name."

**3. Événement `join_success`**
- Nouvel événement envoyé au client après une connexion réussie
- Indique si c'est une reconnexion ou une nouvelle connexion
- Permet au frontend de gérer correctement l'état de chargement

#### Backend (server.js:332-363)

**4. Gestion intelligente des déconnexions**
- Différenciation entre joueurs invités et joueurs authentifiés
- **Joueurs invités en lobby (waiting)** : Retirés automatiquement de la room
- **Joueurs authentifiés** : Conservés dans la partie avec possibilité de reconnexion
- Notification aux autres joueurs via l'événement `player_disconnected`

```javascript
socket.on('disconnect', async () => {
  if (game.status === 'waiting' && !player.userId) {
    // Retirer le joueur invité
    game.players = game.players.filter(p => p.id !== socket.id);
  } else {
    // Notifier les autres (peut reconnecter)
    io.to(game.roomCode).emit('player_disconnected', {
      playerId: socket.id,
      playerName: player.name,
      canReconnect: !!player.userId
    });
  }
});
```

#### Frontend (App.js:67-81, 110-121)

**5. Gestion de l'événement `join_success`**
- Désactivation automatique du loading après connexion réussie
- Affichage d'une alerte pour informer de la reconnexion
- Transition vers l'écran lobby

**6. Notification des déconnexions**
- Écoute de l'événement `player_disconnected`
- Messages différenciés selon que le joueur peut reconnecter ou non

**7. Correction de l'état loading**
- Ajout de `setLoading(false)` dans le handler d'erreur
- Garantit que l'interface reste utilisable même en cas d'erreur

### Comportement après les améliorations

#### Scénario 1 : Nouveau joueur rejoint une room
1. Vérifie que la room existe
2. Vérifie que le jeu n'a pas commencé
3. Vérifie que le nom n'est pas déjà pris
4. Ajoute le joueur et envoie `join_success`
5. Tous les joueurs reçoivent `room_update`

#### Scénario 2 : Joueur authentifié se déconnecte puis reconnecte
1. À la déconnexion : Les autres joueurs sont notifiés qu'il peut reconnecter
2. À la reconnexion : Le système détecte le `userId` existant
3. Met à jour le socket ID du joueur
4. Envoie `join_success` avec `reconnected: true`
5. Affiche "You have been reconnected to the game"

#### Scénario 3 : Joueur invité se déconnecte du lobby
1. Le système détecte que c'est un joueur non authentifié en statut `waiting`
2. Retire automatiquement le joueur de la room
3. Met à jour la liste pour tous les autres joueurs

#### Scénario 4 : Tentative de rejoindre avec un nom déjà pris
1. Le système détecte le doublon (insensible à la casse)
2. Retourne une erreur explicite
3. Le joueur peut choisir un autre nom

### Fichiers modifiés
- `/home/cheetoh/pi-agent/repo/UnderCover/backend/server.js` (lignes 121-202, 332-363)
- `/home/cheetoh/pi-agent/repo/UnderCover/frontend/App.js` (lignes 67-81, 110-121)

### Tests effectués
- ✅ Vérification de la syntaxe JavaScript (backend et frontend)
- ✅ Validation des imports et dépendances
- ⚠️ Tests manuels recommandés pour valider les scénarios de reconnexion

### Améliorations apportées par rapport à la version précédente

| Fonctionnalité | Avant | Après |
|----------------|-------|-------|
| Reconnexion | ❌ Impossible | ✅ Automatique pour utilisateurs authentifiés |
| Noms dupliqués | ⚠️ Autorisés | ✅ Bloqués avec message clair |
| Déconnexion lobby | ⚠️ Joueurs fantômes | ✅ Nettoyage automatique |
| État loading | ⚠️ Parfois bloqué | ✅ Toujours désactivé correctement |
| Feedback utilisateur | ⚠️ Limité | ✅ Notifications de déconnexion/reconnexion |

### Recommandations pour la suite
1. **Tests de charge** : Valider le comportement avec plusieurs déconnexions simultanées
2. **Timeout de reconnexion** : Implémenter un délai max de reconnexion (ex: 5 minutes)
3. **Persistance des rooms** : Sauvegarder l'état des parties en cours pour résister aux redémarrages du serveur
4. **Indicateur visuel** : Afficher les joueurs déconnectés (mais pouvant reconnecter) avec un statut spécifique
5. **Tests automatisés** : Créer des tests d'intégration pour les scénarios de connexion/déconnexion
