import React from "react";

const JOKES = [
  "Tokens were harmed in the making.",
  "The context window remembers.",
  "One more prompt. Famous last words.",
  "Your cache misses have been noted.",
  "The bill has entered the chat.",
  "This footer also cost tokens.",
  "The tokens know what they did.",
] as const;

const LAST_JOKE_KEY = "token-larper-last-footer-joke";

function pickJoke(): string {
  let previous = -1;
  try {
    const saved = sessionStorage.getItem(LAST_JOKE_KEY);
    if (saved !== null) previous = Number(saved);
  } catch {
    // The footer still works when storage is unavailable.
  }

  const choices = JOKES.map((_, index) => index).filter((index) => index !== previous);
  const index = choices[Math.floor(Math.random() * choices.length)]!;
  try { sessionStorage.setItem(LAST_JOKE_KEY, String(index)); } catch {}
  return JOKES[index];
}

const joke = pickJoke();

export function AppFooter() {
  return (
    <footer className="app-footer">
      <span>Made by <a href="https://github.com/YarooqH" target="_blank" rel="noopener noreferrer">qray</a></span>
      <span className="footer-separator" aria-hidden="true">·</span>
      <span>{joke}</span>
      <span className="footer-separator" aria-hidden="true">·</span>
      <a className="footer-source" href="https://github.com/YarooqH/token-larper" target="_blank" rel="noopener noreferrer">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.23.48-2.69-1.08-2.69-1.08-.36-.92-.89-1.16-.89-1.16-.73-.5.06-.49.06-.49.81.06 1.24.83 1.24.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.65 7.65 0 0 1 4.01 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.08-.01 1.95-.01 2.21 0 .21.15.46.55.38A8.02 8.02 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        <span>Source on GitHub</span>
      </a>
    </footer>
  );
}
