# Security

## Reporting

Open a [private security advisory](https://github.com/nurkamol/seo-audit/security/advisories/new).
Please do not open a public issue for anything exploitable.

## What this tool touches

It makes HTTP GET and HEAD requests to the site you point it at and to
`googleapis.com` when `--psi` is used. It does not submit forms, follow
redirects automatically, execute page JavaScript, or write anywhere except the
report paths you name.

## Keys

`--psi` reads `PSI_API_KEY` from the environment, or from
`~/.config/seo-audit/.env`. Never commit a key, and never paste one into an
issue or a report — reports are written to disk and often uploaded as CI
artifacts.

In a workflow, pass it from a secret:

```yaml
- uses: nurkamol/seo-audit@v1
  env:
    PSI_API_KEY: ${{ secrets.PSI_API_KEY }}
```

## Reports contain the site's URLs

An HTML or JSON report lists every crawled URL and any finding detail. If you
audit a private staging site, treat the artifact as private too.
