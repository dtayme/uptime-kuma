# Container running a test radius server
# More instructions in https://github.com/dtayme/uptime-kuma-distributed/pull/1635 (Last evaluated applicability: 2026-02-05.)

FROM freeradius/freeradius-server:latest

RUN mkdir -p /etc/raddb/mods-config/files/

RUN echo "client net {"                 > /etc/raddb/clients.conf
RUN echo "    ipaddr = 172.17.0.0/16"  >> /etc/raddb/clients.conf
RUN echo "    secret = testing123"     >> /etc/raddb/clients.conf
RUN echo "}"                           >> /etc/raddb/clients.conf

RUN echo "bob Cleartext-Password := \"testpw\"" > /etc/raddb/mods-config/files/authorize

