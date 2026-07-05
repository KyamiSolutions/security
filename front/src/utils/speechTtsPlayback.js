/** Minimal silent WAV — play() during a user gesture unlocks TTS on iOS / Safari. */
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

/**
 * @description Unlock HTMLAudioElement playback in the current user-gesture stack (call before any await).
 * @param {HTMLAudioElement} audio - Reused audio element for the voice session.
 * @returns {Promise<void>} Resolves when unlock succeeded or was ignored.
 */
export function unlockSpeechTtsPlayback(audio) {
  audio.pause();
  audio.src = SILENT_WAV_DATA_URL;
  return audio.play().then(
    () => {
      audio.pause();
      audio.currentTime = 0;
    },
    () => {
      /* Strict autoplay policies: TTS may still fail later; response text remains visible. */
    }
  );
}

/**
 * @description Play a remote TTS URL on a previously unlocked audio element.
 * @param {HTMLAudioElement} audio - Audio element unlocked during mic button click.
 * @param {string} ttsUrl - URL returned by /api/v1/gateway/voice.
 * @param {() => void} onEnded - Called when playback finishes.
 * @returns {Promise<void>}
 */
export async function playSpeechTtsUrl(audio, ttsUrl, onEnded) {
  audio.onended = onEnded;
  audio.src = ttsUrl;
  await audio.play();
}

/**
 * @description Speak text using the browser's own (free, offline) speech synthesis, used as a
 * fallback when no paid Gladys Plus TTS is configured (ttsUrl is null).
 * @param {string} text - Text to speak.
 * @param {string} [lang] - BCP 47 language tag (e.g. 'et', 'en-US'); browser default if omitted.
 * @param {() => void} onEnded - Called when speech finishes (or immediately if unsupported).
 * @returns {void}
 * @example
 * speakWithBrowserTts('Tuli on sisse lülitatud', 'et', () => {});
 */
export function speakWithBrowserTts(text, lang, onEnded) {
  if (!window.speechSynthesis || !text) {
    onEnded();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (lang) {
    utterance.lang = lang;
  }
  utterance.onend = onEnded;
  utterance.onerror = onEnded;
  window.speechSynthesis.speak(utterance);
}
