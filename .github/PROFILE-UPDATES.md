# Profile updates

[Refresh profile](https://github.com/pljf/pljf/actions/workflows/refresh-profile.yml) runs daily at 07:17 UTC, on changes to its scripts, and through **Run workflow**. GitHub may delay scheduled runs. No personal token or WakaTime account is needed; the workflow uses its built-in `GITHUB_TOKEN` with repository contents permission to commit generated files.

- The 3D calendar, streak card, and 30-day graph use GitHub's contribution calendar over the most recent 365 UTC dates, including today. The current streak can continue from yesterday while today is still in progress. Longest streak means longest within that window.
- Repository stats cover public repositories owned by `pljf`. Original repository counts exclude forks; received star and fork counts include all owned public repositories.
- Coding rhythm counts unique public commits authored by `pljf` that GitHub indexes on default branches in that window. It converts author timestamps to `America/New_York`, including daylight saving changes. Morning is 06:00–11:59, daytime 12:00–17:59, evening 18:00–23:59, and night 00:00–05:59. These are commit times, not measured hours spent coding. Its total differs from the calendar, which also counts other contribution types.
- Search results are paginated and large or incomplete searches are split by date. A failed or incomplete fetch stops the update before publication, leaving the last successful profile visible. GitHub can take time to index recent activity.
- Generated counts and daily data live in `data/profile.json`; individual commit messages, emails, and tokens are never saved. Generated chart SVGs live in `assets/`. The two marked sections in `README.md` are refreshed; the rest is hand edited.

To refresh immediately, open the workflow link above, choose **Run workflow**, and use `main`. Inspect the latest run there if the last refreshed date is old. GitHub can disable schedules after 60 days without repository activity; re-enable the workflow if that occurs.

Local calculation checks: `node --test scripts/*.test.cjs` (Node.js 24). The refresh script itself requires `GITHUB_TOKEN`; normally it should run in GitHub Actions.

Sources: [GitHub contribution calendar](https://docs.github.com/en/graphql/reference/users#contributioncalendar), [commit search](https://docs.github.com/en/rest/search/search#search-commits), [scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [built-in authentication](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
