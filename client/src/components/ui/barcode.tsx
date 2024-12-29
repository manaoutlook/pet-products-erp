import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeProps {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
  margin?: number;
  background?: string;
}

export function Barcode({
  value,
  width = 2,
  height = 100,
  fontSize = 20,
  margin = 10,
  background = "#ffffff"
}: BarcodeProps) {
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, value, {
        width,
        height,
        fontSize,
        margin,
        background,
        format: "CODE128",
        displayValue: true,
      });
    }
  }, [value, width, height, fontSize, margin, background]);

  return <svg ref={barcodeRef} />;
}
