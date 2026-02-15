import { type GolemFaceHandle } from "./GolemFace";

export function DevPanel({ faceRef }: { faceRef: React.RefObject<GolemFaceHandle | null> }) {
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
    </div>
  );
}

function Button({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "#ccc",
        padding: "6px 12px",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "inherit",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
      }}
    >
      {label}
    </button>
  );
}
