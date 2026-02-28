name: Daily Update Songs List

on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  update-songs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Fetch latest songs list from origin
        id: fetch
        run: |
          ORIGIN_HOST="${{ secrets.ORIGIN_HOST }}"
          if [ -z "$ORIGIN_HOST" ]; then
            ORIGIN_HOST="https://fandorabox.net"
          fi
          curl -s -f "$ORIGIN_HOST/api/maichart/list.all" -o songs.json || exit 1
          echo "fetched=true" >> $GITHUB_OUTPUT

      - name: Update songs-data.js
        run: |
          SONGS_JSON=$(jq -c . songs.json)
          # 替换 songs-data.js 中的 export const SONGS_LIST = ... 行
          sed -i "s|^export const SONGS_LIST = .*;|export const SONGS_LIST = $SONGS_JSON;|" songs-data.js
          if git diff --quiet; then
            echo "No changes detected. Exiting."
            exit 0
          fi

      - name: Commit and push changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add songs-data.js
          git commit -m "Auto-update songs list [skip ci]"
          git push
