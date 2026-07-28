export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xl">
        <h1
          className="font-medium"
          style={{
            fontSize: "var(--text-2xl)",
            fontFamily: "var(--font-display)",
          }}
        >
          Intelligent Product Lab
        </h1>
        <p className="mt-3" style={{ color: "var(--text-secondary)" }}>
          Foundation build in progress. The workspace arrives with the first
          vertical journey.
        </p>
      </div>
    </main>
  );
}
