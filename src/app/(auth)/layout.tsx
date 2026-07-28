export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <p className="font-display text-lg font-medium">
          Intelligent Product Lab
        </p>
        <div className="mt-8 rounded-md border border-edge-subtle bg-surface-primary p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
