"use client";

import React from "react";

export default function RefreshButton() {
  return (
    <button 
      onClick={() => window.location.reload()} 
      className="mt-6 px-8 py-3 bg-emerald-600 text-white font-black text-lg rounded-full shadow-lg hover:bg-emerald-500 transition-all hover:scale-105 active:scale-95"
    >
      Recargar Página
    </button>
  );
}
