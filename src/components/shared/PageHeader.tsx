export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-base font-medium tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-sm text-text-faint">{subtitle}</p>
      )}
    </div>
  );
}
