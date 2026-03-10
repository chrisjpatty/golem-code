import { type GolemFaceHandle } from "./GolemFace";

export function DevPanel({
  faceRef,
  onRandomFace,
  onResetFace,
  onRandomColor,
  onResetColor,
  subagentCount,
  onSpawnSubagent,
  onRemoveSubagent,
  onRemoveAllSubagents,
}: {
  faceRef: React.RefObject<GolemFaceHandle | null>;
  onRandomFace: () => void;
  onResetFace: () => void;
  onRandomColor: () => void;
  onResetColor: () => void;
  subagentCount: number;
  onSpawnSubagent: () => void;
  onRemoveSubagent: () => void;
  onRemoveAllSubagents: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 10,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <Button
        label="Start Speaking"
        onClick={() => faceRef.current?.startSpeaking()}
      />
      <Button
        label="Stop Speaking"
        onClick={() => faceRef.current?.stopSpeaking()}
      />
      <Button
        label="Start Eye Glow"
        onClick={() => faceRef.current?.startEyeGlow()}
      />
      <Button
        label="Stop Eye Glow"
        onClick={() => faceRef.current?.stopEyeGlow()}
      />
      <Button
        label="Head Snap Left"
        onClick={() => faceRef.current?.headSnapLeft()}
      />
      <Button
        label="Head Snap Right"
        onClick={() => faceRef.current?.headSnapRight()}
      />
      <Button
        label="Snap Down Left"
        onClick={() => faceRef.current?.headSnapDownLeft()}
      />
      <Button
        label="Snap Down Right"
        onClick={() => faceRef.current?.headSnapDownRight()}
      />
      <Button
        label="Head Shake"
        onClick={() => faceRef.current?.headShake()}
      />
      <Button
        label="Head Nod"
        onClick={() => faceRef.current?.headNod()}
      />
      <Button label="Smile" onClick={() => faceRef.current?.setExpression('smile')} />
      <Button label="Frown" onClick={() => faceRef.current?.setExpression('frown')} />
      <Button label="Oh" onClick={() => faceRef.current?.setExpression('oh')} />
      <Button label="Neutral" onClick={() => faceRef.current?.setExpression('neutral')} />
      <Button label="Random Face" onClick={onRandomFace} />
      <Button label="Reset Face" onClick={onResetFace} />
      <Button label="Random Color" onClick={onRandomColor} />
      <Button label="Reset Color" onClick={onResetColor} />
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "4px 0" }} />
      <Button label={`Spawn Subagent (${subagentCount})`} onClick={onSpawnSubagent} />
      <Button label="Remove Subagent" onClick={onRemoveSubagent} />
      <Button label="Remove All Subagents" onClick={onRemoveAllSubagents} />
    </div>
  );
}

function Button({ label, onClick, highlight }: { label: string; onClick: () => void; highlight?: boolean }) {
  const bg = highlight ? "rgba(255,102,68,0.25)" : "rgba(255,255,255,0.08)";
  const borderColor = highlight ? "rgba(255,102,68,0.5)" : "rgba(255,255,255,0.15)";
  return (
    <button
      onClick={onClick}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        color: highlight ? "#ff6644" : "#ccc",
        padding: "6px 12px",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "inherit",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = highlight ? "rgba(255,102,68,0.35)" : "rgba(255,255,255,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = bg;
      }}
    >
      {label}
    </button>
  );
}
