import { normalizeWord, splitSentenceSegments } from '../utils/text';

interface SentenceBlockProps {
  sentence: string;
  translation?: string;
  variant?: 'title' | 'subtitle' | 'body';
  disableSentenceClick?: boolean;
  onSentenceClick: () => void;
  onWordDoubleClick: (word: string, position: { x: number; y: number }) => void;
}

export function SentenceBlock({
  sentence,
  translation,
  variant = 'body',
  disableSentenceClick = false,
  onSentenceClick,
  onWordDoubleClick,
}: SentenceBlockProps) {
  function handleWordDoubleClick(
    rawWord: string,
    position: { x: number; y: number },
  ) {
    const normalized = normalizeWord(rawWord);
    if (normalized) {
      onWordDoubleClick(normalized, position);
    }
  }

  const segments = splitSentenceSegments(sentence);

  return (
    <div className="sentence-wrapper">
      <button
        type="button"
        className={`sentence-button sentence-button-${variant}`}
        onClick={() => {
          if (!disableSentenceClick) {
            onSentenceClick();
          }
        }}
      >
        {segments.map((segment, index) => {
          if (segment.type === 'text') {
            return <span key={`t-${index}`}>{segment.value}</span>;
          }
          return (
            <span
              key={`w-${index}-${segment.value}`}
              className="word-chip"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                handleWordDoubleClick(segment.value, {
                  x: bounds.left + bounds.width / 2,
                  y: bounds.bottom,
                });
              }}
            >
              {segment.value}
            </span>
          );
        })}
      </button>

      {translation ? <p className="sentence-translation">译: {translation}</p> : null}
    </div>
  );
}
