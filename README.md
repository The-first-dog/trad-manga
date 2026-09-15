# MangaTrad — Traducteur de mangas 100% local

Web app **statique** qui traduit des images et des mangas **entièrement dans le
navigateur** : pas de serveur, pas de clé API, pas d'appel à Google Traduction.
Tout (OCR + traduction + retouche d'image) tourne en local sur votre machine.

Déployable telle quelle sur **GitHub Pages**, et **livrable en APK Android**
(coquille WebView) via GitHub Actions — voir *Application Android (APK)*.

> **En bref :** vous déposez un **ZIP d'images**, l'app **traduit tout** toute
> seule et **ressort un ZIP traduit**. Aucune configuration nécessaire.

---

## ✨ Fonctionnalités (V1)

- Import d'une **image** (PNG, JPG, JPEG, WEBP) ou d'un **ZIP** de plusieurs images.
- **Traduction automatique après import** + **export ZIP automatique** à la fin
  (options cochées par défaut) : *déposer un ZIP → récupérer la traduction*.
- **Repli « pivot » par l'anglais** : si la paire directe n'a pas de modèle
  Opus-MT (ex. `ja→fr`), l'app traduit automatiquement via l'anglais
  (`ja→en→fr`). Beaucoup plus de paires fonctionnent sans configuration.
- **Modèle personnalisé** : champ avancé pour imposer un identifiant Hugging Face
  (ex. `Xenova/opus-mt-ja-en`) compatible Transformers.js.
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

## 📱 Application Android (APK)

Le dossier **`android/`** contient une **coquille native** (WebView) qui embarque
l'app web : c'est la même application, packagée en **APK installable**. La logique
reste dans les fichiers web à la racine — ils sont copiés dans les *assets* Android
au moment du build (tâche Gradle `copyWebApp`), il n'y a donc **rien à dupliquer**.

Détails techniques utiles :

- Les fichiers web sont servis via **`WebViewAssetLoader`** sur un domaine virtuel
  `https://appassets.androidplatform.net/…`. Indispensable : sur un origin
  `file://`, la WebView bloque les **modules ES** et refuse d'enregistrer un
  **Service Worker**.
- Le **sélecteur de fichiers** natif est branché (`onShowFileChooser`) pour
  importer images / ZIP depuis le téléphone.
- La sortie (ZIP / PNG) est enregistrée dans le dossier **« Téléchargements »**
  via un pont JS (`window.AndroidBridge`), car une WebView n'intercepte pas les
  téléchargements `blob:`.
- `minSdk 29` (Android 10+), `targetSdk 34`. Aucune permission de stockage :
  l'écriture passe par **MediaStore**. Seule permission : **Internet** (pour
  télécharger, au 1ᵉʳ usage, les libs CDN et les modèles Hugging Face).

### Télécharger l'APK

Un workflow GitHub Actions (**`.github/workflows/build-apk.yml`**) construit l'APK
automatiquement :

1. **À chaque push** (ou via *Actions → Build Android APK → Run workflow*),
   l'APK est publiée comme **artefact** : ouvrez l'exécution du workflow puis
   téléchargez `MangaTrad-APK` (section *Artifacts*).
2. **Sur un tag `v*`** (ex. `git tag v1.0 && git push --tags`), l'APK est en plus
   attachée à une **Release GitHub** — lien de téléchargement direct, pratique à
   partager.

> L'APK de la CI est signée avec la **clé de debug** (installable directement sur
> un appareil ayant activé « sources inconnues »). Pour une distribution Play
> Store, il faudra la re-signer avec votre propre keystore.

### Construire l'APK en local

Nécessite un **JDK 17+** et le **SDK Android** (via Android Studio ou les
*command-line tools*, avec `ANDROID_HOME`/`ANDROID_SDK_ROOT` défini) :

```bash
cd android
gradle assembleDebug        # ou ./gradlew si vous générez le wrapper
# APK : android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔧 Changer le modèle de traduction

La traduction utilise les modèles **Opus-MT** convertis pour Transformers.js
(`Xenova/opus-mt-<source>-<cible>`).

**Le plus simple :** dépliez **« Modèle de traduction (avancé) »** dans l'interface
et collez un identifiant Hugging Face (ex. `Xenova/opus-mt-ja-en`). Laissé vide,
l'app choisit automatiquement le modèle de la paire, avec **repli pivot par
l'anglais** si le modèle direct n'existe pas.

Pour changer le comportement par défaut dans le code, l'identifiant du modèle est
construit dans **`translate.js`** :

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
- **Paires de langues** : quand aucun modèle direct Opus-MT n'existe, l'app fait
  désormais un *pivot* automatique par l'anglais. La qualité d'un double saut
  (`src→en→tgt`) est un peu inférieure à une traduction directe.
- **Mise en page** : le détourage des bulles est une approximation (rectangle
  arrondi + couleur moyenne), pas une vraie détection de bulle.

---

## 🔒 Confidentialité

Aucune image, aucun texte ne quitte votre navigateur. Les seuls accès réseau
sont le **téléchargement initial** des bibliothèques (CDN) et des **modèles
publics** (Hugging Face Hub), mis en cache ensuite pour le hors-ligne.
