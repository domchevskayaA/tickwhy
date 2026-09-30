import StockView from "@/components/StockView";

export async function generateMetadata(props: PageProps<"/stock/[symbol]">) {
  const { symbol } = await props.params;
  return { title: decodeURIComponent(symbol).toUpperCase() };
}

export default async function StockPage(props: PageProps<"/stock/[symbol]">) {
  const { symbol } = await props.params;
  return <StockView symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
