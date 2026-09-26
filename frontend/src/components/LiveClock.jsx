import { useEffect, useState } from "react";

export default function LiveClock({ style }) {
  const [text, setText] = useState("Loading Date & Time...");

  useEffect(() => {
    function update() {
      const now = new Date();
      setText(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      );
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={style}>
      <i className="fa-regular fa-calendar-days me-2"></i>
      <span>{text}</span>
    </div>
  );
}
