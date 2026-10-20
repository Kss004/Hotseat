export interface VoiceSupport {
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
}

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResultGroup {
  isFinal: boolean;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultGroup;
  };
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

export interface SpeechRecognizerInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognizerInstance;

export function detectVoiceSupport(): VoiceSupport {
  if (typeof window === "undefined") {
    return { hasSpeechRecognition: false, hasSpeechSynthesis: false };
  }

  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  const hasSpeechRecognition = Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  const hasSpeechSynthesis = Boolean("speechSynthesis" in window);

  return { hasSpeechRecognition, hasSpeechSynthesis };
}

export function createSpeechRecognizer(params: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (err: string) => void;
  onEnd: () => void;
}): SpeechRecognizerInstance | null {
  if (typeof window === "undefined") return null;

  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  const RecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!RecognitionClass) return null;

  const recognition = new RecognitionClass();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  // Reports the whole transcript heard so far in this listening session (final + interim), so the caller
  // can replace its draft text rather than append fragments that interim results would duplicate.
  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    let transcript = "";
    let allFinal = true;
    for (let i = 0; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
      if (!event.results[i].isFinal) allFinal = false;
    }
    params.onTranscript(transcript.trim(), allFinal);
  };

  recognition.onerror = (event: SpeechRecognitionErrorLike) => {
    params.onError(event.error || "Speech recognition error");
  };

  recognition.onend = () => {
    params.onEnd();
  };

  return recognition;
}

export function speakPersonaReply(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Clean text from markdown or formatting characters for natural speech
  const cleanText = text.replace(/[*_#`[\]()]/g, "").trim();
  if (!cleanText) {
    onEnd?.();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.02;
  utterance.pitch = 0.95; // Authoritative executive tone

  // Attempt to select an executive natural English voice
  const voices = window.speechSynthesis.getVoices();
  const executiveVoice =
    voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Natural") || v.name.includes("Premium") || v.name.includes("Google"))
    ) || voices.find((v) => v.lang.startsWith("en"));

  if (executiveVoice) {
    utterance.voice = executiveVoice;
  }

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
