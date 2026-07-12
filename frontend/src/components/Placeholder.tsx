interface PlaceholderProps {
  title: string;
  description: string;
}

export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div style={{ padding: '32px' }}>
      <h2 style={{ fontSize: 15, marginBottom: 8 }}>{title}</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{description}</p>
    </div>
  );
}
