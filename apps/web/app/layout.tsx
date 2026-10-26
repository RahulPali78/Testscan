import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Veriqo — Development workspace',
  description: 'Connect applications, define expected outcomes and verify complete workflows.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
