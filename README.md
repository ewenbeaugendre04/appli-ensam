# Appli ENSAM

Web app installable (iPad + iPhone) : emploi du temps Lise, partiels, tâches liées aux cours, matières par UE.

- `app/` : l'application (publiée sur GitHub Pages).
- `scripts/sync.mjs` : synchro horaire Lise → calendrier, tâches et partiels → lien d'abonnement `.ics`.
- `.github/workflows/sync.yml` : exécute la synchro toutes les heures et publie le site.

Aucune donnée personnelle n'est stockée ici : tout est dans le dépôt privé `appli-ensam-data`,
lu avec le secret `DATA_TOKEN`.
