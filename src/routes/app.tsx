"use client";

import { Dashboard, Receipt, Wallet, CreditCard, ListChecks, TrendingUp, Tags, Sparkles, Transfer, User } from "lucide-react"; // Import all missing icons

// ... existing code ...

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: Dashboard }, // Fixed LayoutDashboard → Dashboard
  { to: "/app/transactions", label: "Lançamentos", icon: Receipt },
  { to: "/app/accounts", label: "Contas e Cartões", icon: Wallet },
  { to: "/app/invoices", label: "Faturas", icon: CreditCard },
  { to: "/app/bills", label: "Recorrentes", icon: ListChecks },
  { to: "/app/investments", label: "Investimentos", icon: TrendingUp },
  { to: "/app/categories", label: "Categorias", icon: Tags },
  { to: "/app/insights", label: "Insights", icon: Sparkles },
  { to: "/app/transfers", label: "Transferir", icon: Transfer }, // NEW: Transfer icon
  { to: "/app/profiles", label: "Perfil", icon: User },
];

// ... rest of the component unchanged ...

return (
  <div className="min-h-screen flex bg-background">
    {/* ... existing sidebar and main content ... */}
  </div>
);