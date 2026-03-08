/**
 * gist.js — proxies UGO data to GitHub Gists via the Cloudflare Worker.
 * The Worker holds the bot token server-side; no credentials are exposed here.
 */

const GIST_WORKER_URL = 'https://usergeneratedorbitbot.navarenko.workers.dev';

async function createGist(filename, content, description) {
  try {
    await fetch(GIST_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content, description }),
    });
  } catch (e) {
    // Silently fail — never disrupt the user experience
  }
}
