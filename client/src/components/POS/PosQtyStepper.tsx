import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

interface PosQtyStepperProps {
  quantity: number;
  onChange: (quantity: number) => void;
  /** Lowest value the stepper may reach: 0 while picking, 1 once the line is in the cart. */
  min?: number;
  disabled?: boolean;
  /** Product name, so screen readers announce "Decrease quantity of <product>". */
  itemName: string;
}

/**
 * The single quantity control used by both halves of the POS screen.
 *
 * The product list and the cart used to each carry their own stepper (`h-8` outline buttons in
 * one, `h-7` ghost buttons in the other, different paddings and border placement), so the same
 * line changed shape the moment it was added and the two panels drifted apart whenever one was
 * edited. One component means a product looks identical before and after it enters the cart.
 */
export function PosQtyStepper({
  quantity,
  onChange,
  min = 0,
  disabled = false,
  itemName,
}: PosQtyStepperProps) {
  return (
    <div className="flex shrink-0 items-center rounded border">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onChange(quantity - 1)}
        disabled={disabled || quantity <= min}
        aria-label={`Decrease quantity of ${itemName}`}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span className="min-w-[2rem] text-center text-sm tabular-nums">{quantity}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onChange(quantity + 1)}
        disabled={disabled}
        aria-label={`Increase quantity of ${itemName}`}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
