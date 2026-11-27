# Appli ENSAM

Web app installable (iPad + iPhone) : emploi du temps Lise, partiels, tâches liées aux cours, matières par UE.

## Organisation du dépôt

- `app/` : l'application (publiée sur GitHub Pages), sans étape de compilation.
  - `index.html`, `style.css`, `manifest.webmanifest`, `sw.js` (cache hors ligne), icônes.
  - `app.js` : cœur de l'appli (données, vues, agenda, tâches, partiels).
  - `revision.js`, `python.js`, `py-worker.js`, `py/` : onglet Réviser et exercices Python.
  - Écarts entre le lien iCal et le site Lise (chargés dans cet ordre, chacun complète le précédent) :
    - `ecarts.js` : lecture de `ecarts.json` / `decisions.json`, Appliquer / Ignorer, agenda en deux demi-colonnes (Std / Lise) les jours concernés.
    - `ecarts-clic.js` : créneaux et partiels qui n'existent que sur le site (cliquables, listés dans les partiels).
    - `ecarts-choix.js` : choix de la bonne version (iCal ou Lise) depuis la fiche du cours ; pointillés, trait plein, listes filtrées ; enregistré dans `choix.json`.
    - `ecarts-infos.js` : onglet « Écarts » (verdict, explication, détails, détection des cours suspects).
- `scripts/sync.mjs` : synchro horaire Lise → calendrier, tâches et partiels → lien d'abonnement `.ics`.
- `scripts/notes.mjs` : récupération des notes Lise.
- `scripts/netlify.mjs` : publie le calendrier « cours seulement » sur Netlify (adresse lisible), si le secret `NETLIFY_TOKEN` existe.
- `.github/workflows/sync.yml` : exécute les synchros toutes les heures, à chaque push et à la demande, puis publie le site.

Aucune donnée personnelle n'est stockée ici : tout est dans le dépôt privé `appli-ensam-data`,
lu avec le secret `DATA_TOKEN`.
