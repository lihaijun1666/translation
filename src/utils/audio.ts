function speakBySystemTts(word: string): void {
  if (!('speechSynthesis' in window) || !word.trim()) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function playWordPronunciation(word: string, audioUrl?: string): void {
  if (!audioUrl) {
    speakBySystemTts(word);
    return;
  }

  const audio = new Audio(audioUrl);
  audio.preload = 'auto';

  const fallbackTimer = window.setTimeout(() => {
    speakBySystemTts(word);
  }, 1800);

  const clearFallback = () => {
    window.clearTimeout(fallbackTimer);
  };

  audio.addEventListener(
    'playing',
    () => {
      clearFallback();
    },
    { once: true },
  );
  audio.addEventListener(
    'error',
    () => {
      clearFallback();
      speakBySystemTts(word);
    },
    { once: true },
  );

  void audio.play().catch(() => {
    clearFallback();
    speakBySystemTts(word);
  });
}
