import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function Accordion({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        className="w-full text-left flex items-center justify-between"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {children}
        <ChevronDown
          className={cn(
            "transition-transform duration-200",
            open ? "rotate-180" : ""
          )}
        />
      </button>
      <div className={open ? "p-2" : ""}>{children}</div>
    </div>
  );
}

/* Example usage for new asset types:
   <Accordion>
     <h3>Carteira (Dinheiro)</h3>
     <p>Saldo disponível: R$ 1.200</p>
   </Accordion>
   <Accordion>
     <h3>Vale‑Alimentação</h3>
     <p>Saldo: R$ 350</p>
   </Accordion>
*/