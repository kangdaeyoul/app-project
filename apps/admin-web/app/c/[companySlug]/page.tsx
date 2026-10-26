import Home from "../../workspace";
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ companySlug: string }>;
}) {
  const { companySlug } = await params;
  return <Home companySlug={companySlug} />;
}
