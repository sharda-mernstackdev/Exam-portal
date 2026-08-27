export default function FullscreenGate({ onEnter, title, message, buttonLabel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#0f172a",
        color: "#fff",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
      }}
    >
      <i className="fa-solid fa-lock fa-4x text-warning mb-3"></i>
      <h3 className="fw-bold">{title}</h3>
      <p className="text-secondary px-3" style={{ maxWidth: 420 }}>{message}</p>
      <button type="button" className="btn btn-warning btn-lg fw-bold mt-3 px-4" onClick={onEnter}>
        <i className="fa-solid fa-expand me-2"></i>{buttonLabel}
      </button>
    </div>
  );
}
