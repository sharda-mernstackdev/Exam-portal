import { useEffect, useRef } from "react";

/**
 * useChart(type, data, options) — thin wrapper around Chart.js (loaded
 * globally via the CDN script tag in index.html), so each chart card in the
 * admin dashboard can just describe its data/options declaratively.
 */
export function useChart(type, data, options) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return undefined;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(canvasRef.current, { type, data, options });
    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data), JSON.stringify(options), type]);

  return canvasRef;
}
