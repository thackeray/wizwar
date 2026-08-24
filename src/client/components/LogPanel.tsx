// Log panel: scrollable event log, auto-scrolls to bottom.
import { useEffect, useRef } from 'react';
import type { GameState } from '../../core/types';

export default function LogPanel({ state }: { state: GameState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [state.log.length]);

  return (
    <div className="log-panel">
      <div className="log-title">Game Log</div>
      <div className="log-content" ref={ref}>
        {state.log.slice(-80).map((l, i) => (
          <div key={i} className="log-line">
            <span style={{ opacity: 0.5 }}>[T{l.turn}]</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
