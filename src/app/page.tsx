import { AdventureFlow } from "@/components/flow/AdventureFlow";
import { MapProvider, MapView } from "@/components/map";

export default function Home() {
  return (
    <MapProvider>
      <main className="relative h-dvh w-full overflow-hidden">
        <h1 className="sr-only">Harharetki – löydä tuttu kaupunki uudelleen</h1>
        <MapView />
        <AdventureFlow />
      </main>
    </MapProvider>
  );
}
