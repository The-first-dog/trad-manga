# MangaTrad — Traducteur de mangas 100% local

Web app **statique** qui traduit des images et des mangas **entièrement dans le
navigateur** : pas de serveur, pas de clé API, pas d'appel à Google Traduction.
Tout (OCR + traduction + retouche d'image) tourne en local sur votre machine.

Déployable telle quelle sur **GitHub Pages**.

---

## ✨ Fonctionnalités (V1)

- Import d'une **image** (PNG, JPG, JPEG, WEBP) ou d'un **ZIP** de plusieurs images.
- File de traitement avec **barre de progression globale + par image**.
- Choix de la **langue source** et de la **langue cible**.
- **OCR local** (Tesseract.js) avec récupération des *bounding boxes*.
- **Regroupement** des mots proches en blocs de texte (≈ bulles).
- **Traduction locale** (Transformers.js / modèles Opus-MT) — aucune API externe.
- **Effacement** du texte d'origine : rectangle arrondi rempli de la couleur
  moyenne environnante, bords légèrement adoucis.
- **Réécriture** du texte traduit dans la même zone : taille de police adaptée,
  retour à la ligne automatique, centrage horizontal **et** vertical.
- **Prévisualisation avant / après**.
- **Édition manuelle** de chaque traduction avant export.
- **Téléchargement** d'une image ou de **toutes les images en ZIP**.
- **Journal** d'erreurs simple.
- Traitement **image par image** en `async/await` : l'interface ne se bloque jamais.
- **Service Worker** : après le premier chargement, les fichiers et les modèles
  sont mis en cache pour fonctionner hors-ligne.

---

## 🧱 Architecture

| Fichier              | Rôle                                                            |
|----------------------|----------------------------------------------------------------|
| `index.html`         | Structure de la page, chargement des libs externes.            |
| `style.css`          | Style moderne, sombre et responsive.                           |
| `app.js`             | Orchestration : UI, file de traitement, pipeline complet.      |
| `ocr.js`             | OCR local (Tesseract.js) + regroupement des mots en blocs.     |
| `translate.js`       | Traduction locale (Transformers.js / Opus-MT).                 |
| `imageProcessor.js`  | Canvas : effacement du texte, rendu du texte traduit.          |
| `zipManager.js`      | Import / export ZIP (JSZip).                                    |
| `sw.js`              | Service Worker : cache du shell + des modèles.                 |
| `README.md`          | Ce fichier.                                                    |

**Bibliothèques** (chargées via CDN, aucune installation) :
[Tesseract.js](https://github.com/naptha/tesseract.js),
[Transformers.js](https://github.com/xenova/transformers.js),
[JSZip](https://stuk.github.io/jszip/).

---

## ▶️ Lancer en local

L'app utilise des **modules ES** et un **Service Worker** : il faut la servir via
HTTP (un simple double-clic sur `index.html` ne suffit pas).

Avec Python (déjà installé sur la plupart des machines) :

```bash
cd trad-manga
python3 -m http.server 8000
```

Puis ouvrez **http://localhost:8000**.

Alternatives :

```bash
npx serve .        # Node.js
php -S localhost:8000
```

> ⚠️ Le **premier** traitement télécharge les modèles (langue OCR + modèle de
> traduction), ce qui peut prendre quelques dizaines de secondes selon votre
> connexion. Ensuite, tout est mis en cache.

---

## 🚀 Déployer sur GitHub Pages

1. Poussez ces fichiers à la **racine** d'un dépôt GitHub.
2. Dans le dépôt : **Settings → Pages**.
3. **Source** : `Deploy from a branch`.
4. Choisissez la branche (ex. `main`) et le dossier **`/ (root)`**, puis **Save**.
5. Patientez ~1 minute : votre app est en ligne sur
   `https://<utilisateur>.github.io/<dépôt>/`.

Aucune étape de build n'est nécessaire : tout est statique.

> Le Service Worker et les chemins sont **relatifs** (`./`), donc le déploiement
> fonctionne même dans un sous-dossier (`/<dépôt>/`).

---

## 🔧 Changer le modèle de traduction

La traduction utilise les modèles **Opus-MT** convertis pour Transformers.js
(`Xenova/opus-mt-<source>-<cible>`).

L'identifiant du modèle est construit dans **`translate.js`** :

```js
export function modelIdFor(srcOpus, tgtOpus) {
  return `Xenova/opus-mt-${srcOpus}-${tgtOpus}`;
}
```

Pour utiliser un autre modèle, modifiez cette fonction. Exemples :

```js
// Forcer un modèle précis quelle que soit la paire :
return 'Xenova/opus-mt-ja-en';

// Utiliser une famille multilingue (ex. mBART, M2M100, NLLB)
// — adaptez aussi l'appel dans translateText() selon l'API du modèle.
return 'Xenova/nllb-200-distilled-600M';
```

Vous trouverez les modèles compatibles sur le Hub Hugging Face en filtrant par
la bibliothèque **transformers.js** :
<https://huggingface.co/models?library=transformers.js&pipeline_tag=translation>

### Ajouter / modifier une langue

Les langues disponibles sont définies en haut de **`app.js`** :

```js
const LANGS = [
  { label: 'Japonais', tess: 'jpn', opus: 'ja' },
  // ...
];
```

- `tess` = code de langue **Tesseract** (OCR).
- `opus` = code de langue **Opus-MT** (traduction).

Ajoutez une entrée pour proposer une nouvelle langue. Toutes les paires
`opus-mt-<source>-<cible>` n'existent pas forcément : si une paire est
introuvable, le journal l'indique (envisagez alors un *pivot* par l'anglais).

---

## ⚠️ Limites de la V1

- **OCR imparfait** : la précision dépend de la qualité de l'image, de la police
  et du contraste. Des erreurs de reconnaissance sont normales — utilisez le
  bouton **Éditer la traduction** pour corriger avant export.
- **Texte vertical japonais** difficile : Tesseract lit principalement à
  l'horizontale. Le japonais vertical (tategaki) donne de mauvais résultats.
  (Piste : ajouter la langue `jpn_vert` côté Tesseract.)
- **Gros ZIP = lent** : tout tourne sur votre machine (CPU/GPU local). Un grand
  nombre de pages, ou un PC modeste, ralentit nettement le traitement.
- **Paires de langues** limitées aux modèles Opus-MT existants. Certaines paires
  passent mal en direct et nécessiteraient une traduction *pivot* par l'anglais.
- **Mise en page** : le détourage des bulles est une approximation (rectangle
  arrondi + couleur moyenne), pas une vraie détection de bulle.

---

## 🔒 Confidentialité

Aucune image, aucun texte ne quitte votre navigateur. Les seuls accès réseau
sont le **téléchargement initial** des bibliothèques (CDN) et des **modèles
publics** (Hugging Face Hub), mis en cache ensuite pour le hors-ligne.
