import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <p className="text-neutral-400">
      The wall goes here: every title on record, filtered by where you are with it.
    </p>
  );
}
