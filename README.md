# ODONTO — version Cloudflare Worker + Supabase

Cette version fait exactement la même chose que l'application Node.js
(`odonto-app/`) : enregistrement des patients, consultations, diagnostics,
traitements, paiements, et génération des rapports (activité SNIS + rapport
financier) exportables en `.xlsx`.

La différence est uniquement l'hébergement :

| | Version Node.js (`odonto-app/`) | Version Cloudflare (ce dossier) |
|---|---|---|
| Serveur | Node.js (Railway, VPS, etc.) | Cloudflare Workers |
| Base de données | fichier SQLite local | Supabase (projet **FAMMSIM**, le même que votre app neuro-chir) |
| Dépendances npm | aucune | aucune |
| Coût | dépend de l'hébergeur Node | gratuit dans l'immense majorité des cas (plan gratuit Cloudflare + Supabase) |

Aucune des deux versions n'est supprimée : gardez `odonto-app/` de côté si
vous préférez revenir à Railway un jour, les deux se basent sur le même
fonctionnement.

## Pourquoi cette option

Vous avez déjà des projets sur Supabase et vous hébergez votre application
**neuro-chir** sur Cloudflare avec Supabase pour les données. ODONTO suit
exactement le même principe : les données vivent dans votre projet Supabase
**FAMMSIM**, dans des tables à part (toutes préfixées `odonto_`), qui ne
touchent jamais aux tables de neuro-chir (`fiches`, `parametres`,
`neuro_profils`, `neuro_docs`).

## Ce qui a déjà été fait pour vous

- Les tables `odonto_users`, `odonto_sessions`, `odonto_patients`,
  `odonto_consultations`, `odonto_consultation_diagnostics`,
  `odonto_consultation_traitements`, `odonto_custom_pathologies`,
  `odonto_custom_traitements` ont été créées dans votre projet FAMMSIM.
- Elles sont verrouillées par défaut (Row Level Security activée, sans
  règle) : seule l'application (via sa clé secrète `service_role`, voir
  plus bas) peut y lire ou écrire. Personne d'autre ne peut y accéder.
- Un compte administrateur a été créé :
  - Identifiant : `admin`
  - Mot de passe : **`KSbbFL9sqfso`** — notez-le et changez-le dès votre
    première connexion (menu Utilisateurs, une fois connecté en tant
    qu'admin).

## Mise en ligne, étape par étape

### 1. Mettre ce dossier sur GitHub

Si vous avez déjà un dépôt GitHub pour ODONTO, ajoutez-y ce dossier
`cloudflare-worker` (ou créez un nouveau dépôt juste pour cette version,
selon ce qui vous semble le plus simple). Si vous ne savez pas comment
faire, c'est la même manipulation que vous avez déjà faite pour connecter
GitHub à Railway.

### 2. Créer le Worker sur Cloudflare et le connecter à GitHub

1. Allez sur [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Créer une application** → **Workers** → **Importer un dépôt Git** (ou « Connect to Git »).
2. Choisissez votre dépôt GitHub, puis le dossier contenant ce code (si le
   dépôt contient aussi d'autres projets, indiquez le sous-dossier dans les
   réglages de build, « Root directory »).
3. Cloudflare détecte automatiquement `wrangler.toml` : laissez les réglages
   proposés (build command vide, c'est normal — il n'y a rien à compiler).
4. Validez. Cloudflare déploie une première fois (elle échouera tant que les
   secrets ci-dessous ne sont pas renseignés — c'est normal, continuez).

### 3. Renseigner les secrets Supabase

Toujours sur la page de votre Worker dans le tableau de bord Cloudflare :
**Settings** → **Variables and Secrets** → **Add**. Ajoutez deux secrets
(type « Secret », pas « Text ») :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | `https://hglxyyqaouzjitaynfjq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé **`service_role`** de votre projet FAMMSIM |

Pour trouver la clé `service_role` : tableau de bord Supabase → projet
**FAMMSIM** → **Project Settings** → **API** → section « Project API keys »
→ copiez la clé intitulée **`service_role`** (⚠️ pas la clé `anon`/`public`,
qui n'a pas le droit d'accéder aux données).

**Important :** cette clé donne un accès complet à toutes les données du
projet FAMMSIM (odonto ET neuro-chir). Ne la partagez avec personne, ne la
mettez jamais dans un fichier du dépôt GitHub — elle doit seulement exister
dans les secrets du Worker, à l'abri.

Après avoir ajouté les deux secrets, redéployez (Cloudflare le fait
automatiquement, ou bouton « Redeploy » si besoin).

### 4. Tester

Ouvrez l'URL de votre Worker (affichée en haut de sa page, du type
`https://odonto.<votre-compte>.workers.dev`). Vous devez voir l'écran de
connexion. Connectez-vous avec `admin` / `KSbbFL9sqfso`, puis changez
immédiatement ce mot de passe.

### 5. (Optionnel) Nom de domaine personnalisé

Dans **Settings** → **Domains & Routes** de votre Worker, vous pouvez
rattacher un nom de domaine que vous possédez déjà, exactement comme pour
neuro-chir.

## Organisation du code (pour information)

```
cloudflare-worker/
  wrangler.toml          configuration du Worker (nom, secrets attendus, dossier public/)
  src/
    index.js            point d'entrée (routes /api/*)
    router.js            micro-routeur (sans dépendance)
    auth.js               hachage de mot de passe (PBKDF2) + sessions
    supabase.js           client REST minimal vers Supabase (PostgREST)
    routes/               une route par domaine (auth, users, patients, consultations, reference, reports, import)
    utils/                logique des rapports, tranches d'âge, génération/lecture .xlsx, import Excel
      xlsx/               zip.js + xlsxBuilder.js (écriture), inflate.js + xlsxReader.js (lecture)
      importMapping.js    reconnaissance des colonnes Excel + conversion de valeurs
      importer.js         logique de création/dédoublonnage lors d'un import
    data/                 listes officielles (pathologies, traitements, indicateurs, importFields.js)
  public/                 front-end (identique à odonto-app/public, inchangé)
  test/                   scripts de test (voir ci-dessous)
```

Comme pour la version Node.js, **aucune dépendance npm n'est nécessaire**
pour que l'application fonctionne : pas de framework web, pas de
bibliothèque de génération Excel — tout est écrit directement avec les
fonctions natives du runtime (fetch, Web Crypto, etc.).

## Import d'un registre Excel existant

Menu *Importer un fichier Excel* (réservé aux administrateurs) : identique en
tout point à la version Node.js (voir `odonto-app/README.md` pour le détail
du fonctionnement — chargement, vérification de la correspondance des
colonnes, puis compte-rendu détaillé). Aucune valeur n'est jamais inventée,
les patients déjà existants ne sont qu'enrichis, et les diagnostics/
traitements non reconnus passent par le même mécanisme que le bouton
« + Ajouter » de l'interface.

La seule différence technique avec la version Node.js est l'absence de
`node:zlib` dans le runtime Cloudflare Workers : la lecture d'un fichier
`.xlsx` réel (compressé en DEFLATE par Excel/LibreOffice/Google Sheets)
passe par un petit décompresseur DEFLATE écrit en JS pur
(`src/utils/xlsx/inflate.js`), testé et validé contre `node:zlib` (voir
`test/unit_inflate.mjs`).

## Tests inclus

- `test/unit_reportbuilder.mjs` : vérifie la logique des rapports
  (tranches d'âge, totaux, regroupement des diagnostics personnalisés,
  rapport financier) avec des données simulées, sans toucher à votre vraie
  base. Lancer avec : `node test/unit_reportbuilder.mjs`.
- `test/unit_inflate.mjs` : vérifie le décompresseur DEFLATE pur JS contre
  `node:zlib`, sur des cas synthétiques et sur les vraies entrées
  compressées du fichier `test/registre_test.xlsx`.
- `test/unit_import.mjs` : vérifie la fonctionnalité d'import Excel de bout
  en bout (reconnaissance des colonnes, dédoublonnage des patients, création
  de diagnostics personnalisés, conservation des données complémentaires)
  avec une base Supabase simulée en mémoire.
- `test/smoke.mjs` : test de bout en bout (connexion, création patient,
  consultation, rapports, export Excel) contre une vraie base Supabase.
  Il a besoin d'une clé d'accès et de policies temporaires pour fonctionner
  sans passer par Cloudflare — à réserver à quelqu'un à l'aise avec
  Supabase ; ce n'est pas nécessaire pour une utilisation normale.

## Limite connue

Ce code n'a pas pu être testé automatiquement contre votre vraie base
FAMMSIM depuis l'environnement où il a été écrit (restriction réseau de cet
environnement, sans rapport avec Cloudflare ou Supabase eux-mêmes). Il a
en revanche été vérifié avec des données simulées reproduisant exactement
les réponses attendues de Supabase. **La première vraie vérification aura
lieu une fois déployé** (étape 4 ci-dessus) : testez une création de
patient et une consultation complète avant de considérer la bascule comme
terminée, et gardez `odonto-app/` (version Node.js/Railway) disponible en
secours jusqu'à ce que vous soyez rassuré·e.
