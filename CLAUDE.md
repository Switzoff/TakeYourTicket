# TakeYourTicket — Notes projet

## Stack
- Node.js + Express (backend)
- Firebase Auth (Google Sign-In) + Firestore
- Railway (déploiement depuis la branche `main`)
- TMDB API (affiches de films)

## Tâches à faire plus tard

### Application native (iOS/Android)
- Configurer **Universal Links** (iOS) et **App Links** (Android) pour que scanner un QR code avec la caméra du téléphone ouvre directement l'app au lieu du navigateur.
- Les URL concernées : `/.../scan/:id` et `/scan-page/:id`
- Non urgent tant qu'on reste sur le web/PWA.

### Documents légaux (avant ouverture publique)
- Aujourd'hui : templates basiques dans `public/legal.html` (`/cgu` et `/confidentialite`) — suffisent en beta privée
- Avant de lancer publiquement : passer sur **iubenda** (gratuit jusqu'à quelques milliers d'utilisateurs, ~30€/an pour la version pro) ou équivalent. Génère automatiquement CGU + politique de confidentialité + bandeau cookies, mis à jour quand la loi change.
- Alternative : CNIL (modèles officiels FR gratuits) ou avocat one-shot (~300-800€) quand monétisation.
- Mentions à ajouter dans la politique RGPD : un **email de contact** pour les demandes d'accès / suppression (obligatoire RGPD article 13).

### Email de contact (bloquant pour RGPD)
- Pas encore d'adresse de contact dans la politique de confidentialité ni dans les Réglages → support
- À faire avant ouverture publique :
  1. Acheter le domaine `takeyourticket.com` (~10€/an chez OVH / Gandi / Cloudflare)
  2. Configurer une redirection email gratuite : `contact@takeyourticket.com` → email perso
  3. Mettre à jour la politique de confidentialité (`public/legal.html`) et le bouton "Contacter le support" dans `public/reglages.html` (`#support-link`)

