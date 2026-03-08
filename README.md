# CEE Platform — Guide de déploiement

Application de gestion des stocks CEE (Classique & Précarité) — Phase 1.

---

## Mise en ligne en 30 minutes (zéro expérience requise)

### Ce que vous aurez à la fin
- Une URL publique (ex: `https://cee-platform-equipe.vercel.app`)
- Accessible par toute votre équipe depuis n'importe quel navigateur
- Données partagées via le fichier `public/data.json`

---

## Étape 1 — Créer un compte GitHub (5 min)

1. Allez sur **https://github.com** → "Sign up"
2. Créez un compte avec votre email pro
3. Choisissez le plan **Free**

---

## Étape 2 — Créer le repository (3 min)

1. Sur GitHub, cliquez **"New repository"** (bouton vert en haut à droite)
2. Configurez :
   - **Repository name** : `cee-platform`
   - **Visibility** : `Private` ← important (données financières)
   - Ne cochez rien d'autre
3. Cliquez **"Create repository"**

---

## Étape 3 — Uploader les fichiers (5 min)

La façon la plus simple sans ligne de commande :

1. Sur la page de votre repo vide, cliquez **"uploading an existing file"**
2. Glissez-déposez **tous les fichiers** du dossier `cee-platform/` :
   ```
   index.html
   package.json
   vite.config.js
   .gitignore
   src/
     App.jsx
     main.jsx
   public/
     data.json
   ```
3. En bas, cliquez **"Commit changes"**

> 💡 **Alternative avec Git** (si vous avez Git installé) :
> ```bash
> cd cee-platform
> git init
> git add .
> git commit -m "Initial commit"
> git remote add origin https://github.com/VOTRE_USERNAME/cee-platform.git
> git push -u origin main
> ```

---

## Étape 4 — Créer un compte Vercel (3 min)

1. Allez sur **https://vercel.com** → "Sign Up"
2. Choisissez **"Continue with GitHub"** ← connecte automatiquement votre repo
3. Plan **Hobby (Free)** suffit largement

---

## Étape 5 — Déployer sur Vercel (5 min)

1. Sur Vercel, cliquez **"Add New… → Project"**
2. Importez votre repo `cee-platform` depuis GitHub
3. Vercel détecte Vite automatiquement. Laissez les paramètres par défaut :
   - **Framework Preset** : Vite
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`
4. Cliquez **"Deploy"**
5. Attendez ~2 minutes → vous recevez une URL du type `https://cee-platform-xxx.vercel.app`

**C'est en ligne.** Partagez cette URL à votre équipe.

---

## Mettre à jour les données

Toute modification de `public/data.json` sur GitHub **redéploie automatiquement** en ~30 secondes.

### Modifier les données (exemple : ajouter un trade)

**Option A — Directement sur GitHub (recommandé phase 1) :**
1. Ouvrez `public/data.json` sur GitHub
2. Cliquez l'icône crayon ✏️ en haut à droite
3. Modifiez le JSON
4. Cliquez **"Commit changes"**
5. Vercel redéploie → tout le monde voit la mise à jour

**Option B — En local avec VS Code :**
```bash
# Modifier public/data.json avec VS Code ou n'importe quel éditeur
git add public/data.json
git commit -m "Update: nouveau trade t37 Mars 2026"
git push
# → Vercel redéploie automatiquement
```

---

## Structure de data.json

```json
{
  "trades": [
    {
      "id": "t37",
      "ceeType": "CLASSIQUE",          // "CLASSIQUE" ou "PRECARITE"
      "vendor": "ACT (Mandat 2026)",
      "dealType": "Fixed Price",
      "period": "P6",
      "volume": 250.0,                 // GWhc
      "price": 9100,                   // €/GWhc
      "month": "2026-04",
      "status": "PENDING",             // "PENDING" ou "APPROVED"
      "priced": false,                 // true = obligation pricée
      "createdBy": "u1",
      "approvedBy": null,
      "createdAt": "2026-04-01T09:00:00Z",
      "ranking": null,
      "statut": "Attribué",
      "emmyValidated": false
    }
  ],
  "prices": [
    {
      "id": "p20",
      "date": "2026-03-07",
      "classique": 8.97,               // €/MWhc
      "precarite": 16.45,
      "enteredBy": "u1",
      "enteredAt": "2026-03-07T08:00:00Z"
    }
  ],
  "curve": {
    "SPOT":    { "classique": 8.96, "precarite": 16.44 },
    "S1-26":   { "classique": 8.96, "precarite": 16.05 },
    "S2-26":   { "classique": 8.93, "precarite": 15.81 }
  }
}
```

---

## Accès équipe

Pour l'instant, tout le monde accède avec la même URL.
La sélection d'utilisateur (SM / JD / CB) se fait dans l'interface.

**En Phase 2**, on ajoutera une vraie authentification (email + mot de passe).

---

## Passage en Phase 2 — Quand vous êtes prêts

Quand vous souhaitez passer à une vraie base de données (Supabase) avec :
- Sauvegardes automatiques en temps réel (plus de git push)
- Authentification par email
- Historique complet persisté

La migration prend environ une journée. Le frontend React change très peu.
Contactez-nous et on génère le kit Phase 2.

---

## En cas de problème

| Problème | Solution |
|----------|----------|
| Page blanche | Ouvrez la console navigateur (F12) et cherchez l'erreur |
| "data.json not found" | Vérifiez que `public/data.json` est bien committé sur GitHub |
| Build Vercel échoue | Vérifiez que `package.json` et `vite.config.js` sont présents |
| Vercel ne redéploie pas | Allez sur Vercel → votre projet → "Redeploy" |

---

*CEE Platform v1.0 — Phase 1 (données via data.json)*
