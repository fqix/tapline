export const SHELLS = ['Bash', 'Fish', 'Nushell', 'CMD', 'PowerShell'] as const
export type Shell = (typeof SHELLS)[number]

/** Commands for pasting into an existing terminal, without modifying shell profiles. */
export function shellEnvironment(env: Record<string, string>, shell: Shell): string {
    const commands = Object.entries(env).map(([name, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /[\0\r\n]/.test(value))
            throw new Error('Invalid environment variable')
        switch (shell) {
            case 'Bash':
                return `${name}='${value.replace(/'/g, "'\\''")}'`
            case 'Fish':
                return `set -gx ${name} '${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
            case 'Nushell':
                return `$env.${name} = ${JSON.stringify(value)}`
            case 'PowerShell':
                return `$env:${name} = '${value.replace(/'/g, "''")}'`
            case 'CMD':
                // Percent expansion and delayed expansion can corrupt literal paths;
                // embedded quotes can expose command operators in an interactive CMD.
                if (/["%!]/.test(value))
                    throw new Error('CMD cannot safely represent this value; use PowerShell')
                return `set "${name}=${value}"`
        }
    })
    if (!commands.length) return ''
    return shell === 'Bash'
        ? `export ${commands.join(' ')}`
        : commands.join(shell === 'CMD' ? ' & ' : '; ')
}
