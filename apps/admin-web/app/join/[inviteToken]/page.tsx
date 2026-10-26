import Home from "../../workspace";
export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteToken: string }>;
}) {
  const { inviteToken } = await params;
  return <Home inviteToken={inviteToken} />;
}
