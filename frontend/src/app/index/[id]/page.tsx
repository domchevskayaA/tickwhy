import IndexView from "@/components/IndexView";

export async function generateMetadata(props: PageProps<"/index/[id]">) {
  const { id } = await props.params;
  return { title: decodeURIComponent(id).toUpperCase() };
}

export default async function IndexPage(props: PageProps<"/index/[id]">) {
  const { id } = await props.params;
  return <IndexView id={decodeURIComponent(id).toUpperCase()} />;
}
