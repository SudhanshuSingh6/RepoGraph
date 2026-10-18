package com.example.jobs;

public abstract class BaseJob {
    public final void run() {
        long start = System.currentTimeMillis();
        execute();
        System.out.println(name() + " took " + (System.currentTimeMillis() - start) + "ms");
    }

    protected abstract void execute();

    protected abstract String name();
}
