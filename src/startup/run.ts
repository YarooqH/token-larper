/** Run a program and collect its output and exit code (reg.exe, launchctl). */
export async function run(argv: string[]): Promise<{ code: number; output: string; error: string }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [output, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output, error };
}
