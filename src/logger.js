const config = require('./config.js');
const { AsyncLocalStorage } = require('async_hooks');

const requestContext = new AsyncLocalStorage();

class Logger {
    httpLogger = (req, res, next) => {
    const context = {
        userId: req.user?.id || null
    };

    let send = res.send;

    res.send = (resBody) => {
        const logData = {
            userId: context.userId,
            authorized: !!req.headers.authorization,
            path: `${req.hostname}${req.originalUrl}`,
            ip: req.ip,
            method: req.method,
            statusCode: res.statusCode,
            req: JSON.stringify(req.body),
            res: resBody
        };

        const level = this.statusToLogLevel(res.statusCode);
        this.log(level, 'http', logData);

        res.send = send;
        return res.send(resBody);
    };

    requestContext.run(context, next);
};

    log(level, type, logData) {
        logData = this.sanitizeLogData(logData);
        const labels = { component: config.logging.source, level: level, type: type };
        const values = [this.nowString(), logData];
        const logEvent = { streams: [{ stream: labels, values: [values] }] };

        this.sendLogToGrafana(logEvent);
    }

    statusToLogLevel(statusCode) {
        if (statusCode >= 500) return 'error';
        if (statusCode >= 400) return 'warn';
        return 'info';
    }

    nowString() {
        return Math.floor(Date.now() * 1000000).toString();
    }

    sanitizeLogData(logData) {
        logData = JSON.stringify(logData);
        logData = logData.replace(/\\"password\\":\s*\\"[^"]*\\"/g, '\\"password\\": \\"*****\\"');
        logData = logData.replace(/\\"token\\":\s*\\"[^"]*\\"/g, '\\"token\\": \\"*****\\"');

        return logData;
    }

    sendLogToGrafana(event) {
        const body = JSON.stringify(event);

        fetch(config.logging.endpointUrl, {
            method: 'POST',
            body,
            headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
            },
        })
            .then((res) => {
            if (!res.ok) {
                console.log('Failed to send log to Grafana:', res.status);
            }
            })
            .catch((err) => {
            console.error('Could not send log to Grafana:', err.message);
            });
        }

    getUserId() {
        return requestContext.getStore()?.userId || null;
    }
}




module.exports = new Logger();