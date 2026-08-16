import { useState } from "react";
import { JournalPrompt } from "./components/JournalPrompt";

export default function App() {
  const [open, setOpen] = useState(true);

  if (open) return <JournalPrompt onClose={() => setOpen(false)} />;

  return (
    <main className="journal-home">
      <span>FIELD NOTES / PRIVATE</span>
      <button onClick={() => setOpen(true)} type="button">Return to the desk</button>
    </main>
  );
}
