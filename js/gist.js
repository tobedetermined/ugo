/**
 * gist.js — saves UGO data directly to GitHub Gists via the bot token.
 * Token is set inline in index.html for production,
 * and overridden by telemetry-config.js for local dev.
 */

async function createGist(filename, content, description) {
  const token = window.UGO_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'ugo-bot',
      },
      body: JSON.stringify({
        description,
        public: false,
        files: { [filename]: { content } },
      }),
    });
  } catch (e) {
    // Silently fail — never disrupt the user experience
  }
}
