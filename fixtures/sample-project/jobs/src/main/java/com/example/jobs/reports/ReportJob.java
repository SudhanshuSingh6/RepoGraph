package com.example.jobs.reports;

import com.example.jobs.BaseJob;
import com.example.jobs.model.Order;

public class ReportJob extends BaseJob {
    @Override
    protected void execute() {
        Order order = new Order();
        System.out.println("report for order " + order.getId());
    }

    @Override
    protected String name() {
        return "report";
    }
}
