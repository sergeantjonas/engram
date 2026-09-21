# nginx for engram

Two vhosts, both committed as **plain HTTP**. That is deliberate and not an
oversight: a vhost naming a certificate that has not been issued yet makes
`nginx -t` fail, which blocks the reload that has to happen before certbot can
issue anything.

`scripts/deploy.sh` copies these to `/srv/engram/deploy/nginx/` on the box. It
does **not** install them — nginx and systemd are left alone by the deploy on
purpose, so a routine deploy can never break the ingress for the other tenant
on the same machine.

## First install

Run on the box, once:

```sh
sudo cp /srv/engram/deploy/nginx/engram.vyoh.gg.conf \
        /srv/engram/deploy/nginx/api.engram.vyoh.gg.conf \
        /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/engram.vyoh.gg.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.engram.vyoh.gg.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Then the certificate, one covering both names:

```sh
sudo certbot --nginx -d engram.vyoh.gg -d api.engram.vyoh.gg
```

Renewal is the bundled `certbot.timer`. There is no cron to add.

## After certbot, never `cp` over these again

Certbot **rewrites the installed files in place** — it adds the `listen 443
ssl` block, the certificate paths and the `:80` redirect. The copies in this
repo stay plain HTTP by the rule above, so copying one over an installed file
silently drops TLS and the site keeps answering, on port 80, with no warning.

To change a vhost after the first certificate: edit the installed file under
`/etc/nginx/sites-available/` directly, or copy and re-run certbot.

## No `conf.d/` file

Neither vhost declares anything that has to live in the `http` context —
no `proxy_cache_path`, no `limit_req_zone`. If one ever does, it goes in its
own file under `/etc/nginx/conf.d/` and **every name in it must be prefixed
`engram_`**: that directory is one namespace shared with every other tenant,
and a colliding zone name makes nginx refuse to load with an error that names
neither file.
