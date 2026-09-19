import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ApiError } from './api/client.ts';
import { createAppRouter } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx is a decision, not a hiccup: retrying "you are not the owner"
      // only delays telling the viewer so.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status < 500),
    },
  },
});
const router = createAppRouter(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
